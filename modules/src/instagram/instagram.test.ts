import { describe, expect, it } from "vitest";
import {
  classifyInstagramError,
  describeInstagramError,
  InstagramCallError,
  isMediaFetchFailure,
} from "./errors";
import { createGraphClient, type GraphCallRecord, oauthCall, pathOnly } from "./http";
import { capturingLogger, mockRuntime, newMock } from "./test-support";

// The Graph API wrapper, the error table (09 §9.4.4) and the mock Graph API (M5-01).

const body = (code: number, message = "m", subcode?: number) => ({
  error: {
    message,
    code,
    ...(subcode === undefined ? {} : { error_subcode: subcode }),
    fbtrace_id: "T1",
  },
});

describe("classifyInstagramError", () => {
  const classOf = (signal: Parameters<typeof classifyInstagramError>[0]) =>
    classifyInstagramError(signal).classification;

  it.each([
    [{ network: true }, "TRANSIENT"],
    [{ httpStatus: 500 }, "TRANSIENT"],
    [{ httpStatus: 503, body: body(2) }, "TRANSIENT"],
    [{ httpStatus: 400, body: body(1) }, "TRANSIENT"],
    [{ httpStatus: 429 }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(4) }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(17) }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(32) }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(341) }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(368) }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(613) }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(100, "Application request limit reached") }, "RATE_LIMIT"],
    [{ httpStatus: 400, body: body(190, "expired", 463) }, "AUTH"],
    [{ httpStatus: 400, body: body(190, "checkpoint", 459) }, "AUTH"],
    [{ httpStatus: 403, body: body(10) }, "PERMISSION"],
    [{ httpStatus: 403, body: body(200) }, "PERMISSION"],
    [{ httpStatus: 403, body: body(299) }, "PERMISSION"],
    [
      { httpStatus: 400, body: body(100, "The aspect ratio is not supported", 2207009) },
      "INVALID_MEDIA",
    ],
    [{ httpStatus: 400, body: body(100, "Invalid image format") }, "INVALID_MEDIA"],
    [{ httpStatus: 400, body: body(9007, "The media is not ready", 2207027) }, "TRANSIENT"],
    [{ httpStatus: 400, body: body(100, "Invalid parameter") }, "PERMANENT"],
    [{ httpStatus: 400, body: body(9999, "who knows") }, "UNKNOWN"],
    [{ httpStatus: 404 }, "UNKNOWN"],
  ] as const)("%j is %s", (signal, expected) => {
    expect(classOf(signal)).toBe(expected);
  });

  it("keeps code, subcode, type, trace id and status, and no token", () => {
    const error = classifyInstagramError({
      httpStatus: 400,
      body: {
        error: {
          message: "Bad",
          code: 190,
          error_subcode: 463,
          type: "OAuthException",
          fbtrace_id: "AbC",
        },
      },
    });
    expect(error).toEqual({
      httpStatus: 400,
      code: 190,
      subcode: 463,
      type: "OAuthException",
      message: "Bad",
      fbtraceId: "AbC",
      classification: "AUTH",
    });
  });

  it("tells a media download failure from other media errors", () => {
    const fetchFailure = classifyInstagramError({
      httpStatus: 400,
      body: body(100, "Media upload has failed: could not download the image", 2207003),
    });
    const ratio = classifyInstagramError({
      httpStatus: 400,
      body: body(100, "The aspect ratio is not supported", 2207009),
    });
    expect(isMediaFetchFailure(fetchFailure)).toBe(true);
    expect(isMediaFetchFailure(ratio)).toBe(false);
  });

  it("says what to do next for every class", () => {
    for (const classification of [
      "AUTH",
      "PERMISSION",
      "INVALID_MEDIA",
      "RATE_LIMIT",
      "TRANSIENT",
      "PERMANENT",
      "UNKNOWN",
    ] as const) {
      const text = describeInstagramError({ message: "m", classification });
      expect(text.title.length).toBeGreaterThan(10);
      expect(text.nextStep.length).toBeGreaterThan(10);
    }
  });
});

describe("InstagramCallError", () => {
  it("maps to the job runner's error classes and carries the wait", () => {
    const rate = new InstagramCallError({
      message: "slow down",
      code: 4,
      classification: "RATE_LIMIT",
    });
    expect(rate.toAppError()).toMatchObject({
      name: "TransientError",
      code: "RATE_LIMITED",
      retryAfterMs: 5 * 60_000,
    });
    expect(
      new InstagramCallError({ message: "x", code: 368, classification: "RATE_LIMIT" })
        .retryAfterMs,
    ).toBe(15 * 60_000);
    expect(
      new InstagramCallError({ message: "x", classification: "TRANSIENT" }).toAppError().name,
    ).toBe("TransientError");
    expect(
      new InstagramCallError({ message: "x", classification: "UNKNOWN" }).toAppError().name,
    ).toBe("TransientError");
    expect(
      new InstagramCallError({ message: "x", code: 190, classification: "AUTH" }).toAppError().name,
    ).toBe("PermanentError");
    expect(
      new InstagramCallError({ message: "x", classification: "INVALID_MEDIA" }).toAppError().name,
    ).toBe("PermanentError");
  });
});

describe("the Graph client", () => {
  const TOKEN = "igl-secret-token-do-not-log";

  function setup() {
    const mock = newMock({ accounts: [{ id: "1784", username: "kitchen_es", followers: 500 }] });
    const token = mock.issueToken("1784");
    const rt = mockRuntime(mock);
    const { logger, lines } = capturingLogger();
    const records: GraphCallRecord[] = [];
    const client = createGraphClient(rt, {
      accessToken: token,
      logger,
      onCall: (r) => void records.push(r),
    });
    return { mock, token, rt, logger, lines, records, client };
  }

  it("calls the versioned host with the token in the Authorization header only", async () => {
    const { mock, token, client } = setup();
    const me = await client.get<{ username: string }>("/me", { fields: "user_id,username" });
    expect(me.username).toBe("kitchen_es");
    const [call] = mock.calls;
    expect(call?.authorization).toBe(`Bearer ${token}`);
    expect(call?.query).toEqual({ fields: "user_id,username" });
    expect(JSON.stringify(call?.query)).not.toContain(token);
  });

  it("sends POST parameters as JSON", async () => {
    const { mock, client } = setup();
    await client.post("/1784/media", {
      image_url: "https://r2.test/a.jpg",
      is_carousel_item: true,
    });
    expect(mock.calls[0]?.body).toEqual({
      image_url: "https://r2.test/a.jpg",
      is_carousel_item: true,
    });
  });

  it("never logs the token, and logs the path without the query", async () => {
    const { client, lines, token, records } = setup();
    await client.get("/me", { fields: "username", access_token: TOKEN });
    await client
      .post("/1784/media", {
        image_url: "https://r2.test/a.jpg?X-Amz-Signature=abcdef&X-Amz-Credential=cred",
        is_carousel_item: true,
      })
      .catch(() => {});
    const logs = lines.join("\n");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(TOKEN);
    expect(logs).not.toContain("abcdef");
    expect(logs).toContain("/me");
    expect(logs).not.toContain("fields=");
    // The stored record is redacted too: presigned signatures and tokens are gone.
    const stored = JSON.stringify(records);
    expect(stored).not.toContain("abcdef");
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(TOKEN);
    expect(records[0]?.endpoint).toBe("/me");
  });

  it("throws a classified error with the trace id and still reports the call", async () => {
    const { mock, client, records } = setup();
    mock.revokeToken(mock.tokens.keys().next().value as string);
    const failure = await client.get("/me").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(InstagramCallError);
    expect((failure as InstagramCallError).error).toMatchObject({
      code: 190,
      classification: "AUTH",
      httpStatus: 400,
      fbtraceId: "AMockTrace123",
    });
    expect((failure as InstagramCallError).ambiguous).toBe(false);
    expect(records[0]).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("calls a dropped POST ambiguous and a dropped GET not", async () => {
    const { mock, client, records } = setup();
    mock.fail({ method: "POST", path: /\/media$/, dropAfterEffect: true });
    const post = await client
      .post("/1784/media", { image_url: "https://r2.test/a.jpg", is_carousel_item: true })
      .catch((e: unknown) => e);
    expect((post as InstagramCallError).ambiguous).toBe(true);
    expect((post as InstagramCallError).error.classification).toBe("TRANSIENT");
    expect(mock.containers.size).toBe(1); // the effect happened
    mock.fail({ method: "GET", path: /^\/me$/, dropBeforeEffect: true });
    const get = await client.get("/me").catch((e: unknown) => e);
    expect((get as InstagramCallError).ambiguous).toBe(false);
    expect(records.map((r) => r.httpStatus)).toEqual([undefined, undefined]);
  });

  it("times out a call that does not answer", async () => {
    const mock = newMock({ accounts: [{ id: "1784", username: "k" }] });
    const rt = {
      ...mockRuntime(mock),
      fetch: ((_: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timeout", "TimeoutError")),
          ),
        )) as typeof fetch,
    };
    const { logger } = capturingLogger();
    const client = createGraphClient(rt, { accessToken: "t", logger, timeoutMs: 20 });
    const failure = await client
      .post("/1784/media_publish", { creation_id: "c" })
      .catch((e: unknown) => e);
    expect((failure as InstagramCallError).ambiguous).toBe(true);
    expect((failure as InstagramCallError).error.classification).toBe("TRANSIENT");
  });

  it("refuses to work while publishing is off", () => {
    const mock = newMock();
    const rt = { ...mockRuntime(mock), app: undefined };
    expect(() =>
      createGraphClient(rt, { accessToken: "t", logger: capturingLogger().logger }),
    ).toThrow(/not configured/);
  });

  it("strips a query string from the logged path", () => {
    expect(pathOnly("/1784/media?fields=a,b")).toBe("/1784/media");
  });
});

describe("the mock Graph API", () => {
  it("runs the whole token and publish flow", async () => {
    const mock = newMock({ accounts: [{ id: "1784", username: "kitchen_es" }] });
    const rt = mockRuntime(mock);
    const { logger } = capturingLogger();
    const app = rt.app;
    if (!app) throw new Error("no app");
    const code = mock.issueCode("1784");
    const short = await oauthCall<{ data: { access_token: string; user_id: string }[] }>(
      rt,
      logger,
      {
        method: "POST",
        url: "https://api.instagram.com/oauth/access_token",
        params: {
          client_id: app.appId,
          client_secret: app.appSecret,
          grant_type: "authorization_code",
          redirect_uri: app.redirectUri,
          code,
        },
      },
    );
    expect(short.data[0]?.user_id).toBe("1784");
    const long = await oauthCall<{ access_token: string; expires_in: number }>(rt, logger, {
      method: "GET",
      url: "https://graph.instagram.com/access_token",
      params: {
        grant_type: "ig_exchange_token",
        client_secret: app.appSecret,
        access_token: short.data[0]?.access_token ?? "",
      },
    });
    expect(long.expires_in).toBe(5_183_944);

    const client = createGraphClient(rt, { accessToken: long.access_token, logger });
    const a = await client.post<{ id: string }>("/1784/media", {
      image_url: "https://r2.test/1.jpg",
      is_carousel_item: true,
    });
    const b = await client.post<{ id: string }>("/1784/media", {
      image_url: "https://r2.test/2.jpg",
      is_carousel_item: true,
    });
    const parent = await client.post<{ id: string }>("/1784/media", {
      media_type: "CAROUSEL",
      children: `${a.id},${b.id}`,
      caption: "Hi #one",
      is_ai_generated: true,
    });
    expect(
      (await client.get<{ status_code: string }>(`/${parent.id}`, { fields: "status_code" }))
        .status_code,
    ).toBe("FINISHED");
    const published = await client.post<{ id: string }>("/1784/media_publish", {
      creation_id: parent.id,
    });
    const post = await client.get<{ permalink: string; is_ai_generated: boolean }>(
      `/${published.id}`,
      { fields: "id,permalink,timestamp,is_ai_generated" },
    );
    expect(post.permalink).toContain("instagram.com/p/");
    expect(post.is_ai_generated).toBe(true);
    const recent = await client.get<{ data: { id: string; caption: string }[] }>("/1784/media", {
      fields: "id,caption,timestamp,permalink",
      limit: 10,
    });
    expect(recent.data.map((m) => m.id)).toEqual([published.id]);
    const limit = await client.get<{ data: { quota_usage: number }[] }>(
      "/1784/content_publishing_limit",
      { fields: "quota_usage,config" },
    );
    expect(limit.data[0]?.quota_usage).toBe(1);
  });

  it("refuses a second publish of the same container, bad carousels and long captions", async () => {
    const mock = newMock({ accounts: [{ id: "1784", username: "k" }] });
    const { logger } = capturingLogger();
    const client = createGraphClient(mockRuntime(mock), {
      accessToken: mock.issueToken("1784"),
      logger,
    });
    const a = await client.post<{ id: string }>("/1784/media", {
      image_url: "https://r2.test/1.jpg",
      is_carousel_item: true,
    });
    const b = await client.post<{ id: string }>("/1784/media", {
      image_url: "https://r2.test/2.jpg",
      is_carousel_item: true,
    });
    await expect(
      client.post("/1784/media", { media_type: "CAROUSEL", children: a.id }),
    ).rejects.toMatchObject({ error: { classification: "PERMANENT" } });
    await expect(
      client.post("/1784/media", {
        media_type: "CAROUSEL",
        children: `${a.id},${b.id}`,
        caption: "x".repeat(2201),
      }),
    ).rejects.toBeInstanceOf(InstagramCallError);
    const parent = await client.post<{ id: string }>("/1784/media", {
      media_type: "CAROUSEL",
      children: `${a.id},${b.id}`,
    });
    await client.get(`/${parent.id}`, { fields: "status_code" });
    await client.post("/1784/media_publish", { creation_id: parent.id });
    await expect(
      client.post("/1784/media_publish", { creation_id: parent.id }),
    ).rejects.toBeInstanceOf(InstagramCallError);
    expect(mock.publishedMedia()).toHaveLength(1);
  });

  it("refreshes a token only after 24 hours and makes the old one invalid", async () => {
    let now = new Date("2026-10-10T10:00:00Z");
    const mock = newMock({ accounts: [{ id: "1784", username: "k" }], now: () => now });
    const rt = mockRuntime(mock);
    const { logger } = capturingLogger();
    const token = mock.issueToken("1784");
    const params = { grant_type: "ig_refresh_token", access_token: token };
    const refresh = () =>
      oauthCall<{ access_token: string }>(rt, logger, {
        method: "GET",
        url: "https://graph.instagram.com/refresh_access_token",
        params,
      });
    await expect(refresh()).rejects.toBeInstanceOf(InstagramCallError);
    now = new Date("2026-10-11T11:00:00Z");
    const fresh = await refresh();
    expect(fresh.access_token).not.toBe(token);
    await expect(
      createGraphClient(rt, { accessToken: token, logger }).get("/me"),
    ).rejects.toMatchObject({ error: { classification: "AUTH" } });
  });
});

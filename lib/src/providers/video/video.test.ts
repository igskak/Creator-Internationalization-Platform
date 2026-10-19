import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PermanentError, TransientError, ValidationError } from "../../errors";
import {
  createFakeVideoProvider,
  createHiggsfieldVideoProvider,
  createVideoProvider,
  estimateShotCostUsd,
  fakeMp4,
  type ShotRequest,
} from "./index";

// Contract tests against mocked Higgsfield endpoints (MSW) and tests of the fake and the estimates.

const API = "https://api.higgsfield.ai";
const UPLOAD = "https://upload.example.test/slot-1";
const CDN = "https://cdn.example.test/out.mp4";
const KEY = "key-id-123:secret-456";
const MP4 = fakeMp4("fixture");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

type Seen = { method: string; url: string; headers: Headers; body?: unknown };
let seen: Seen[] = [];
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" } as never));
afterEach(() => {
  server.resetHandlers();
  seen = [];
});
afterAll(() => server.close());

const note = async (request: Request, json = true) => {
  seen.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    ...(json ? { body: await request.clone().json() } : {}),
  });
};

/** Upload slot + submit + a status sequence; the last status repeats. */
function mock(statuses: object[], options: { download?: () => Response } = {}) {
  let polls = 0;
  server.use(
    http.post(`${API}/files/generate-upload-url`, async ({ request }) => {
      await note(request);
      return HttpResponse.json({
        upload_url: UPLOAD,
        upload_headers: { "Content-Type": "image/jpeg", "x-amz-tagging": "temp=1" },
        public_url: "https://cdn.example.test/in.jpeg",
      });
    }),
    http.put(UPLOAD, async ({ request }) => {
      await note(request, false);
      return new HttpResponse(null, { status: 200 });
    }),
    http.post(`${API}/*/image-to-video`, async ({ request }) => {
      await note(request);
      return HttpResponse.json({ status: "queued", request_id: "req-1" });
    }),
    http.get(`${API}/requests/req-1/status`, async ({ request }) => {
      await note(request, false);
      return HttpResponse.json(statuses[Math.min(polls++, statuses.length - 1)]);
    }),
    http.get(CDN, () => options.download?.() ?? new HttpResponse(MP4, { status: 200 })),
  );
}

const request = (over: Partial<ShotRequest> = {}): ShotRequest => ({
  prompt: "Static camera. Golden broth pours into the pot.",
  image: { bytes: JPEG, mimeType: "image/jpeg" },
  durationSeconds: 3,
  idempotencyKey: "reel-1:scene-1:abc",
  ...over,
});
const provider = (over: Partial<Parameters<typeof createHiggsfieldVideoProvider>[0]> = {}) =>
  createHiggsfieldVideoProvider({ apiKey: KEY, sleep: async () => {}, ...over });
const done = { status: "completed", request_id: "req-1", video: { url: CDN } };

describe("Higgsfield video provider", () => {
  it("uploads the picture, submits with an idempotency key, polls and downloads the clip", async () => {
    mock([{ status: "queued" }, { status: "in_progress" }, done]);
    const shot = await provider().generate(request());

    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([
      "POST /files/generate-upload-url",
      "PUT /slot-1",
      "POST /alibaba/wan-3.0/image-to-video",
      "GET /requests/req-1/status",
      "GET /requests/req-1/status",
      "GET /requests/req-1/status",
    ]);
    expect(seen[0]?.headers.get("authorization")).toBe(`Key ${KEY}`);
    expect(seen[0]?.body).toEqual({ content_type: "image/jpeg" });
    // the presigned storage URL gets the vendor's headers and no credentials
    expect(seen[1]?.headers.get("authorization")).toBeNull();
    expect(seen[1]?.headers.get("x-amz-tagging")).toBe("temp=1");
    expect(seen[2]?.headers.get("idempotency-key")).toBe("reel-1:scene-1:abc");
    expect(seen[2]?.body).toEqual({
      image_url: "https://cdn.example.test/in.jpeg",
      prompt: "Static camera. Golden broth pours into the pot.",
      duration: 3,
      resolution: "720p",
      aspect_ratio: "adaptive",
      generate_audio: false,
      enable_thinking: false,
    });
    expect(Buffer.from(shot.bytes)).toEqual(Buffer.from(MP4));
    expect(shot).toMatchObject({
      mimeType: "video/mp4",
      width: 720,
      height: 1280,
      durationSeconds: 3,
      model: "alibaba/wan-3.0",
      providerRequestId: "req-1",
      costUsd: 0.3,
    });
    expect(JSON.stringify(shot.params)).not.toContain(KEY);
  });

  it("sends each model its own body", async () => {
    for (const [model, expected] of [
      ["kling-video/v3.0/std", { sound: "off", cfg_scale: 0.5, multi_shots: false, duration: 5 }],
      ["bytedance/seedance-2.0", { resolution: "720p", generate_audio: false, duration: 5 }],
    ] as const) {
      mock([done]);
      await provider().generate(request({ model, durationSeconds: 5 }));
      const submitted = seen.find((s) => s.url.endsWith("/image-to-video"));
      expect(new URL(submitted?.url ?? "").pathname).toBe(`/${model}/image-to-video`);
      expect(submitted?.body).toMatchObject(expected);
      seen = [];
      server.resetHandlers();
    }
  });

  it("asks each model for its own sound when the shot wants it (Reels v4)", async () => {
    for (const [model, expected] of [
      ["alibaba/wan-3.0", { generate_audio: true }],
      ["kling-video/v3.0/std", { sound: "on" }],
      ["bytedance/seedance-2.0", { generate_audio: true }],
    ] as const) {
      mock([done]);
      await provider().generate(request({ model, durationSeconds: 4, audio: true }));
      const submitted = seen.find((s) => s.url.endsWith("/image-to-video"));
      expect(submitted?.body).toMatchObject(expected);
      seen = [];
      server.resetHandlers();
    }
  });

  it("fails permanently when the clip is blocked, failed or canceled, and names the request", async () => {
    for (const status of ["nsfw", "failed", "canceled"]) {
      mock([{ status }]);
      const error = await provider()
        .generate(request())
        .catch((e) => e);
      expect(error).toBeInstanceOf(PermanentError);
      expect(error.details).toMatchObject({ requestId: "req-1", code: status });
      server.resetHandlers();
    }
  });

  it("times out as transient with the request id and lets the caller wait again without paying", async () => {
    mock([{ status: "in_progress" }]);
    let clock = 0;
    const slow = provider({
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const submitted = await slow.submit(request());
    const error = await slow
      .waitFor(submitted, { timeoutMs: 20_000, pollMs: 8000 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(TransientError);
    expect(error.details).toMatchObject({ requestId: "req-1", code: "timeout" });
    expect(seen.filter((s) => s.url.endsWith("/image-to-video"))).toHaveLength(1);

    server.resetHandlers();
    seen = [];
    mock([done]);
    const shot = await slow.waitFor(submitted);
    expect(shot).toMatchObject({ providerRequestId: "req-1", durationSeconds: 3, costUsd: 0.3 });
    // waiting again never submits again
    expect(seen.filter((s) => s.url.endsWith("/image-to-video"))).toHaveLength(0);
  });

  it("retries a 429 and then succeeds", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/files/generate-upload-url`, () =>
        ++calls === 1
          ? new HttpResponse(null, { status: 429, headers: { "retry-after": "1" } })
          : HttpResponse.json({
              upload_url: UPLOAD,
              public_url: "https://cdn.example.test/in.jpeg",
            }),
      ),
      http.put(UPLOAD, () => new HttpResponse(null, { status: 200 })),
      http.post(`${API}/*/image-to-video`, () => HttpResponse.json({ request_id: "req-1" })),
    );
    const handle = await provider().submit(request());
    expect(handle).toMatchObject({ requestId: "req-1", durationSeconds: 3, resolution: "720p" });
    expect(calls).toBe(2);
  });

  it("maps rejected credentials and a low balance without leaking the key", async () => {
    for (const [status, code] of [
      [401, undefined],
      [402, "payment_required"],
    ] as const) {
      server.use(
        http.post(`${API}/files/generate-upload-url`, () =>
          HttpResponse.json({ detail: `denied for ${KEY}` }, { status }),
        ),
      );
      const error = await provider()
        .submit(request())
        .catch((e) => e);
      expect(error).toBeInstanceOf(PermanentError);
      if (code) expect(error.details).toMatchObject({ code });
      expect(error.message).not.toContain("secret-456");
      server.resetHandlers();
    }
  });

  it("rejects a download that is not an mp4", async () => {
    mock([done], { download: () => new HttpResponse("<html>nope</html>", { status: 200 }) });
    await expect(provider().generate(request())).rejects.toBeInstanceOf(PermanentError);
  });

  it("validates before it spends anything", async () => {
    const p = provider();
    await expect(p.submit(request({ prompt: "  " }))).rejects.toBeInstanceOf(ValidationError);
    await expect(p.submit(request({ idempotencyKey: "" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(p.submit(request({ durationSeconds: 1 }))).rejects.toBeInstanceOf(ValidationError);
    await expect(
      p.submit(request({ model: "bytedance/seedance-2.0", durationSeconds: 3 })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(p.submit(request({ durationSeconds: 2.5 }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(() => createHiggsfieldVideoProvider({ apiKey: "no-colon" })).toThrow(ValidationError);
    expect(seen).toHaveLength(0);
  });
});

describe("estimates", () => {
  it("match the shots measured on 2026-10-13", () => {
    expect(estimateShotCostUsd("alibaba/wan-3.0", 3)).toBe(0.3);
    expect(estimateShotCostUsd("alibaba/wan-3.0", 3, "1080p")).toBe(0.6);
    expect(estimateShotCostUsd("kling-video/v3.0/std", 5)).toBe(0.5355);
    // 5 s 720x1280 at 24 fps = 108,000 tokens at 0.014 USD per thousand
    expect(estimateShotCostUsd("bytedance/seedance-2.0", 5)).toBe(1.512);
  });
});

describe("fake video provider and factory", () => {
  it("is deterministic, records its calls and cannot be mistaken for an mp4 player file", async () => {
    const fake = createFakeVideoProvider();
    const a = await fake.generate(request({ label: "scene-1" }));
    const b = await fake.generate(request({ label: "scene-1" }));
    const c = await fake.generate(request({ idempotencyKey: "other" }));
    expect(Buffer.from(a.bytes)).toEqual(Buffer.from(b.bytes));
    expect(Buffer.from(a.bytes)).not.toEqual(Buffer.from(c.bytes));
    expect(new TextDecoder().decode(a.bytes.subarray(4, 8))).toBe("ftyp");
    expect(a).toMatchObject({ width: 720, height: 1280, costUsd: 0.3 });
    expect(fake.calls).toHaveLength(3);
  });

  it("can be told to fail a shot", async () => {
    const fake = createFakeVideoProvider({
      fail: (_r, call) => (call === 2 ? new TransientError("boom") : undefined),
    });
    await fake.submit(request());
    await expect(fake.submit(request({ idempotencyKey: "k2" }))).rejects.toThrow("boom");
  });

  it("picks the provider from the config and refuses clearly when the key is missing", async () => {
    expect(createVideoProvider({ provider: "fake" }).id).toBe("fake");
    expect(createVideoProvider({ provider: "live", higgsfieldApiKey: KEY }).id).toBe("higgsfield");
    const off = createVideoProvider({ provider: "live" });
    expect(off.id).toBe("disabled");
    await expect(off.generate(request())).rejects.toMatchObject({
      details: { code: "video_disabled" },
    });
  });
});

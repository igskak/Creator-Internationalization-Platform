// A stateful stand-in for the Instagram Graph API (plan 13 §13.3, §13.4, M5-01). It answers every
// call the integration makes, in the shapes Meta documents (M5-00), and can be told to fail in the
// ways the error table classifies. Unit tests pass `mock.fetch` as `InstagramRuntime.fetch`; the
// E2E server serves the same handler over HTTP (`serve.ts`). It is not a model of Meta's behavior
// beyond what the tests need: V-08 and V-14 are decided by the smoke run, not by this file.

export type MockAccount = {
  /** The professional account id (`user_id`). */
  id: string;
  username: string;
  accountType?: "BUSINESS" | "MEDIA_CREATOR" | "PERSONAL";
  followers?: number;
  /** Id used by deauthorize and data-deletion callbacks. */
  appScopedUserId?: string;
};

type Container = {
  id: string;
  accountId: string;
  kind: "CHILD" | "CAROUSEL" | "REELS";
  imageUrl?: string;
  videoUrl?: string;
  shareToFeed?: boolean;
  /** The reason Meta gives next to ERROR (the `status` field). */
  statusDetail?: string;
  children?: string[];
  caption?: string;
  isAiGenerated?: boolean;
  status: "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";
  polls: number;
  mediaId?: string;
};

export type MockMedia = {
  id: string;
  accountId: string;
  caption: string;
  timestamp: string;
  permalink: string;
  containerId: string;
  isAiGenerated: boolean;
};

export type MockCall = {
  method: string;
  /** Path without version, e.g. `/1784/media`. */
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  authorization: string | undefined;
  response: { status: number; body: unknown } | "dropped";
};

/** A rule that makes matching calls fail. Rules are consumed in the order they were added. */
export type MockFault = {
  method?: "GET" | "POST";
  /** Tested against the path without version. */
  path: RegExp;
  /** How many matching calls it affects (default 1). */
  times?: number;
  /** Skip this many matching calls first. */
  skip?: number;
} & (
  | {
      status: number;
      error: { message: string; code?: number; error_subcode?: number; type?: string };
    }
  // The call takes effect on the server, then the connection breaks: the caller sees no answer.
  | { dropAfterEffect: true }
  // The call never reaches the server and the caller sees no answer.
  | { dropBeforeEffect: true }
);

/** What the mock answers for `GET /{ig-id}/insights` of an account (M6-02). Absent = not reported. */
export type MockAccountInsights = {
  reachFollowers?: number;
  reachNonFollowers?: number;
  reachUnknown?: number;
  views?: number;
  accountsEngaged?: number;
  totalInteractions?: number;
  follows?: number;
  unfollows?: number;
};

export type MockGraphOptions = {
  accounts?: MockAccount[];
  /** Container polls before it reports FINISHED (default 1: FINISHED on the first poll). */
  finishAfterPolls?: number;
  /** Every media fetch of an image URL containing this text fails (container goes to ERROR). */
  unfetchableUrlPart?: string;
  /** App secret the code exchange expects. */
  appSecret?: string;
  /** Used to build permalinks and timestamps (default: real time). */
  now?: () => Date;
  /** `content_publishing_limit.quota_usage`. */
  quotaUsage?: number;
  /** An unsupported-metric error names the metric (default true); false = it does not say which. */
  insightsErrorNamesMetric?: boolean;
};

const LONG_LIVED_SECONDS = 5_183_944;
const API_VERSION = /^\/v\d+\.\d+/;

export type MockGraphApi = ReturnType<typeof createMockGraphApi>;

export function createMockGraphApi(options: MockGraphOptions = {}) {
  const now = options.now ?? (() => new Date());
  const accounts = new Map<string, MockAccount>();
  const containers = new Map<string, Container>();
  const media = new Map<string, MockMedia>();
  const calls: MockCall[] = [];
  const faults: (MockFault & { seen: number; used: number })[] = [];
  /** token → account id; `short-…`, `long-…` and refreshed tokens all live here. */
  const tokens = new Map<string, { accountId: string; kind: "short" | "long"; issuedAt: Date }>();
  /** code → account id, for the authorization code exchange. */
  const codes = new Map<string, string>();
  /** Media insights by media id: metric name → value (absent metrics are not reported). */
  const mediaInsights = new Map<
    string,
    { metrics: Record<string, number>; profileActivity?: Record<string, number> }
  >();
  const accountInsights = new Map<string, MockAccountInsights>();
  /** Metrics a media product type refuses, like Instagram does (inferred from third-party reports). */
  const unsupportedByType: Record<"FEED" | "REELS", Set<string>> = {
    FEED: new Set(["ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate"]),
    REELS: new Set(["follows", "profile_visits", "profile_activity"]),
  };
  /** Account metrics refused outright, e.g. `follows_and_unfollows` under 100 followers. */
  const unsupportedAccountMetrics = new Set<string>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}${++counter}${String(9000 + counter)}`;

  const mock = {
    options,
    calls,
    containers,
    media,
    tokens,
    quotaUsage: options.quotaUsage ?? 0,

    hasAccount: (id: string) => accounts.has(id),

    addAccount(account: MockAccount) {
      accounts.set(account.id, account);
      return account;
    },
    /** The code the authorize page would hand back for this account. */
    issueCode(accountId: string): string {
      const code = `code-${accountId}-${++counter}`;
      codes.set(code, accountId);
      return code;
    },
    /** A long-lived token for an account, as if it had been connected earlier. */
    issueToken(accountId: string, issuedAt: Date = now()): string {
      const token = `igl-${accountId}-${++counter}`;
      tokens.set(token, { accountId, kind: "long", issuedAt });
      return token;
    },
    revokeToken(token: string) {
      tokens.delete(token);
    },
    /** A post that is already published (no container steps), for the insights tests. */
    addPublishedMedia(accountId: string, kind: "CAROUSEL" | "REELS" = "CAROUSEL"): string {
      const containerId = nextId("171");
      containers.set(containerId, {
        id: containerId,
        accountId,
        kind,
        status: "PUBLISHED",
        polls: 0,
      });
      const mediaId = nextId("181");
      media.set(mediaId, {
        id: mediaId,
        accountId,
        caption: "",
        timestamp: now().toISOString(),
        permalink: `https://www.instagram.com/p/MOCK${mediaId}/`,
        containerId,
        isAiGenerated: false,
      });
      return mediaId;
    },
    /** What `/{media-id}/insights` reports for a media (the metrics Instagram names). */
    setMediaInsights(
      mediaId: string,
      metrics: Record<string, number>,
      profileActivity?: Record<string, number>,
    ) {
      mediaInsights.set(mediaId, { metrics, ...(profileActivity ? { profileActivity } : {}) });
    },
    setAccountInsights(accountId: string, values: MockAccountInsights) {
      accountInsights.set(accountId, values);
    },
    unsupportedMediaMetrics: unsupportedByType,
    unsupportedAccountMetrics,
    fail(fault: MockFault) {
      faults.push({ ...fault, seen: 0, used: 0 });
    },
    clearFaults() {
      faults.length = 0;
    },
    /** Marks a container as expired or errored, like Meta would after a day or a bad image. */
    setContainerStatus(id: string, status: Container["status"]) {
      const container = containers.get(id);
      if (container) container.status = status;
    },
    callsTo(path: RegExp, method?: string) {
      return calls.filter((c) => path.test(c.path) && (!method || c.method === method));
    },
    publishedMedia(): MockMedia[] {
      return [...media.values()];
    },

    /** The HTTP handler. */
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const path = url.pathname.replace(API_VERSION, "");
      const query = Object.fromEntries(url.searchParams.entries());
      const body = await readBody(request);
      const record: MockCall = {
        method,
        path,
        query,
        body,
        authorization: request.headers.get("authorization") ?? undefined,
        response: "dropped",
      };
      calls.push(record);

      const fault = takeFault(method, path);
      if (fault && "dropBeforeEffect" in fault) throw new TypeError("fetch failed (mock)");
      // An HTTP error answers before the call has any effect.
      if (fault && "status" in fault) {
        const answer = { status: fault.status, body: { error: errorBody(fault.error) } };
        record.response = answer;
        return json(answer.status, answer.body);
      }
      const result = route(method, path, query, body, record.authorization);
      if (fault && "dropAfterEffect" in fault) throw new TypeError("fetch failed (mock)");
      record.response = result;
      return json(result.status, result.body);
    },

    /** `fetch`-compatible: pass it as `InstagramRuntime.fetch`. */
    fetch: (async (input: string | URL | Request, init?: RequestInit) =>
      mock.handle(new Request(input, init))) as typeof fetch,
  };

  for (const account of options.accounts ?? []) mock.addAccount(account);

  function takeFault(method: string, path: string) {
    for (const fault of faults) {
      if (fault.method && fault.method !== method) continue;
      if (!fault.path.test(path)) continue;
      fault.seen += 1;
      if (fault.seen <= (fault.skip ?? 0)) continue;
      if (fault.used >= (fault.times ?? 1)) continue;
      fault.used += 1;
      return fault;
    }
    return undefined;
  }

  type Answer = { status: number; body: unknown };
  const ok = (body: unknown): Answer => ({ status: 200, body });
  const error = (
    status: number,
    message: string,
    code: number,
    subcode?: number,
    type = "OAuthException",
  ): Answer => ({
    status,
    body: {
      error: errorBody({
        message,
        code,
        type,
        ...(subcode === undefined ? {} : { error_subcode: subcode }),
      }),
    },
  });

  /** The account behind a bearer token, or an error answer. */
  function authenticate(authorization: string | undefined, query: Record<string, string>) {
    const token = authorization?.replace(/^Bearer\s+/i, "") ?? query.access_token;
    const entry = token ? tokens.get(token) : undefined;
    if (!entry) {
      return {
        failure: error(400, "Invalid OAuth access token - Cannot parse access token", 190),
      } as const;
    }
    const account = accounts.get(entry.accountId);
    if (!account) return { failure: error(400, "Unsupported get request.", 100) } as const;
    return { account, token: token as string, entry } as const;
  }

  function route(
    method: string,
    path: string,
    query: Record<string, string>,
    body: Record<string, unknown>,
    authorization: string | undefined,
  ): Answer {
    // --- OAuth (outside the versioned API) ---
    if (method === "POST" && path === "/oauth/access_token") {
      const secret = options.appSecret;
      if (secret && body.client_secret !== secret) {
        return {
          status: 400,
          body: { error_type: "OAuthException", code: 400, error_message: "Invalid client secret" },
        };
      }
      const accountId = typeof body.code === "string" ? codes.get(body.code) : undefined;
      if (!accountId) {
        return {
          status: 400,
          body: {
            error_type: "OAuthException",
            code: 400,
            error_message: "Invalid authorization code",
          },
        };
      }
      codes.delete(body.code as string);
      const token = `igs-${accountId}-${++counter}`;
      tokens.set(token, { accountId, kind: "short", issuedAt: now() });
      return ok({
        data: [
          {
            access_token: token,
            user_id: accountId,
            permissions: "instagram_business_basic,instagram_business_content_publish",
          },
        ],
      });
    }
    if (method === "GET" && path === "/access_token") {
      const entry = tokens.get(query.access_token ?? "");
      if (query.grant_type !== "ig_exchange_token" || !entry || entry.kind !== "short") {
        return error(400, "Invalid OAuth access token.", 190);
      }
      const token = `igl-${entry.accountId}-${++counter}`;
      tokens.set(token, { accountId: entry.accountId, kind: "long", issuedAt: now() });
      return ok({ access_token: token, token_type: "bearer", expires_in: LONG_LIVED_SECONDS });
    }
    if (method === "GET" && path === "/refresh_access_token") {
      const entry = tokens.get(query.access_token ?? "");
      if (query.grant_type !== "ig_refresh_token" || !entry || entry.kind !== "long") {
        return error(400, "Invalid OAuth access token.", 190);
      }
      if (now().getTime() - entry.issuedAt.getTime() < 24 * 3_600_000) {
        return error(400, "Cannot refresh a token that is less than 24 hours old.", 100);
      }
      const token = `igl-${entry.accountId}-${++counter}`;
      tokens.delete(query.access_token as string);
      tokens.set(token, { accountId: entry.accountId, kind: "long", issuedAt: now() });
      return ok({ access_token: token, token_type: "bearer", expires_in: LONG_LIVED_SECONDS });
    }

    // --- everything else needs a valid token ---
    const auth = authenticate(authorization, query);
    if ("failure" in auth) return auth.failure;
    const { account } = auth;

    if (method === "GET" && path === "/me") {
      return ok({
        id: account.id,
        user_id: account.id,
        username: account.username,
        account_type: account.accountType ?? "BUSINESS",
        followers_count: account.followers ?? 1200,
      });
    }

    const media$ = /^\/([^/]+)\/media$/.exec(path);
    if (method === "POST" && media$) {
      return createContainer(account, media$[1] as string, body);
    }
    const publish = /^\/([^/]+)\/media_publish$/.exec(path);
    if (method === "POST" && publish) return publishContainer(account, publish[1] as string, body);
    const limit = /^\/([^/]+)\/content_publishing_limit$/.exec(path);
    if (method === "GET" && limit) {
      return ok({
        data: [
          { quota_usage: mock.quotaUsage, config: { quota_total: 100, quota_duration: 86400 } },
        ],
      });
    }
    const insights = /^\/([^/]+)\/insights$/.exec(path);
    if (method === "GET" && insights) {
      const id = insights[1] as string;
      return media.has(id)
        ? mediaInsightsAnswer(id, query)
        : accountInsightsAnswer(account, id, query);
    }
    const recent = /^\/([^/]+)\/media$/.exec(path);
    if (method === "GET" && recent) {
      const list = [...media.values()]
        .filter((m) => m.accountId === account.id)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, Number(query.limit ?? 10))
        .map((m) => ({
          id: m.id,
          caption: m.caption,
          timestamp: m.timestamp,
          permalink: m.permalink,
        }));
      return ok({ data: list });
    }

    const object = /^\/([^/]+)$/.exec(path);
    if (method === "GET" && object) {
      const id = object[1] as string;
      const container = containers.get(id);
      if (container) return containerStatus(container, query.fields ?? "");
      const post = media.get(id);
      if (post) {
        return ok({
          id: post.id,
          permalink: post.permalink,
          timestamp: post.timestamp,
          is_ai_generated: post.isAiGenerated,
        });
      }
      return error(400, `Unsupported get request. Object with ID '${id}' does not exist.`, 100, 33);
    }
    return error(400, `Unknown path ${path}`, 100);
  }

  function mediaInsightsAnswer(mediaId: string, query: Record<string, string>): Answer {
    const post = media.get(mediaId);
    const container = post ? containers.get(post.containerId) : undefined;
    const type = container?.kind === "REELS" ? "REELS" : "FEED";
    const asked = (query.metric ?? "").split(",").filter(Boolean);
    const refused = asked.filter((m) => unsupportedByType[type].has(m));
    if (refused.length > 0) {
      const named = options.insightsErrorNamesMetric !== false;
      return error(
        400,
        named
          ? `(#100) The Media Insights API does not support the ${refused[0]} metric for this media product type.`
          : "(#100) Invalid metric parameter for this media product type.",
        100,
      );
    }
    const configured = mediaInsights.get(mediaId);
    if (query.breakdown === "action_type") {
      const results = Object.entries(configured?.profileActivity ?? {}).map(([k, v]) => ({
        dimension_values: [k.toLowerCase()],
        value: v,
      }));
      return ok({
        data:
          results.length === 0
            ? []
            : [
                {
                  name: "profile_activity",
                  period: "lifetime",
                  total_value: {
                    value: results.reduce((sum, r) => sum + r.value, 0),
                    breakdowns: [{ dimension_keys: ["action_type"], results }],
                  },
                  id: `${mediaId}/insights/profile_activity/lifetime`,
                },
              ],
      });
    }
    // Metrics Instagram has no number for are left out of the answer ("an empty data set").
    const data = asked
      .filter((m) => configured?.metrics[m] !== undefined)
      .map((m) => ({
        name: m,
        period: "lifetime",
        values: [{ value: configured?.metrics[m] }],
        title: m,
        id: `${mediaId}/insights/${m}/lifetime`,
      }));
    return ok({ data });
  }

  function accountInsightsAnswer(
    account: MockAccount,
    idInPath: string,
    query: Record<string, string>,
  ): Answer {
    if (idInPath !== account.id && idInPath !== "me") {
      return error(400, "Unsupported get request. Object does not exist.", 100, 33);
    }
    const asked = (query.metric ?? "").split(",").filter(Boolean);
    const refused = asked.find((m) => unsupportedAccountMetrics.has(m));
    if (refused) {
      return error(400, `(#100) The ${refused} metric is not available for this account.`, 100);
    }
    const v = accountInsights.get(account.id) ?? {};
    const item = (name: string, value: number | undefined) =>
      value === undefined ? [] : [{ name, period: "day", total_value: { value } }];
    const split = (name: string, parts: [string, number | undefined][]) => {
      const results = parts
        .filter((p): p is [string, number] => p[1] !== undefined)
        .map(([k, value]) => ({ dimension_values: [k], value }));
      return results.length === 0
        ? []
        : [
            {
              name,
              period: "day",
              total_value: {
                value: results.reduce((sum, r) => sum + r.value, 0),
                breakdowns: [{ dimension_keys: [query.breakdown ?? "follow_type"], results }],
              },
            },
          ];
    };
    const data = asked.flatMap((m) => {
      if (m === "reach" && query.breakdown === "follow_type") {
        return split("reach", [
          ["FOLLOWER", v.reachFollowers],
          ["NON_FOLLOWER", v.reachNonFollowers],
          ["UNKNOWN", v.reachUnknown],
        ]);
      }
      if (m === "reach") {
        const parts = [v.reachFollowers, v.reachNonFollowers, v.reachUnknown];
        return parts.every((p) => p === undefined)
          ? []
          : item(
              "reach",
              parts.reduce<number>((sum, p) => sum + (p ?? 0), 0),
            );
      }
      if (m === "views") return item("views", v.views);
      if (m === "accounts_engaged") return item("accounts_engaged", v.accountsEngaged);
      if (m === "total_interactions") return item("total_interactions", v.totalInteractions);
      if (m === "follows_and_unfollows") {
        return split("follows_and_unfollows", [
          ["FOLLOWER", v.follows],
          ["NON_FOLLOWER", v.unfollows],
        ]);
      }
      return [];
    });
    return ok({ data });
  }

  function createContainer(
    account: MockAccount,
    idInPath: string,
    body: Record<string, unknown>,
  ): Answer {
    if (idInPath !== account.id && idInPath !== "me") {
      return error(400, "Unsupported post request. Object does not exist.", 100, 33);
    }
    const caption = typeof body.caption === "string" ? body.caption : undefined;
    if (caption !== undefined) {
      const tags = caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
      if (caption.length > 2200 || tags > 30) {
        return error(
          400,
          "Invalid parameter: the caption is too long or has too many hashtags.",
          100,
          2207023,
        );
      }
    }
    if (body.media_type === "REELS") {
      const videoUrl = typeof body.video_url === "string" ? body.video_url : undefined;
      if (!videoUrl) {
        return error(400, "Invalid parameter: video_url is required for REELS.", 100, 2207052);
      }
      // Meta fetches a video after it answers: a URL it cannot read shows up as ERROR on a poll.
      const unfetchable =
        options.unfetchableUrlPart !== undefined && videoUrl.includes(options.unfetchableUrlPart);
      const container: Container = {
        id: nextId("177"),
        accountId: account.id,
        kind: "REELS",
        videoUrl,
        shareToFeed: body.share_to_feed === true,
        status: unfetchable ? "ERROR" : "IN_PROGRESS",
        polls: 0,
        ...(unfetchable
          ? { statusDetail: "Error: Media upload has failed with error code 2207052" }
          : {}),
        ...(caption === undefined ? {} : { caption }),
        ...(body.is_ai_generated === true ? { isAiGenerated: true } : {}),
      };
      containers.set(container.id, container);
      return ok({ id: container.id });
    }
    if (body.media_type === "CAROUSEL") {
      const children = String(body.children ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (children.length < 2 || children.length > 10) {
        return error(400, "Invalid parameter: a carousel needs 2 to 10 children.", 100, 2207057);
      }
      const unknown = children.find((c) => !containers.has(c));
      if (unknown) return error(400, `Invalid parameter: unknown child ${unknown}.`, 100, 2207032);
      const container: Container = {
        id: nextId("178"),
        accountId: account.id,
        kind: "CAROUSEL",
        children,
        status: "IN_PROGRESS",
        polls: 0,
        ...(caption === undefined ? {} : { caption }),
        ...(body.is_ai_generated === true ? { isAiGenerated: true } : {}),
      };
      containers.set(container.id, container);
      return ok({ id: container.id });
    }
    const imageUrl = typeof body.image_url === "string" ? body.image_url : undefined;
    if (!imageUrl || body.is_carousel_item !== true) {
      return error(
        400,
        "Invalid parameter: image_url and is_carousel_item are required for a carousel child.",
        100,
        2207052,
      );
    }
    const unfetchable = options.unfetchableUrlPart && imageUrl.includes(options.unfetchableUrlPart);
    const container: Container = {
      id: nextId("179"),
      accountId: account.id,
      kind: "CHILD",
      imageUrl,
      status: unfetchable ? "ERROR" : "FINISHED",
      polls: 0,
    };
    containers.set(container.id, container);
    if (unfetchable) {
      return error(
        400,
        "Media upload has failed with error code 2207003: Instagram could not download the image.",
        100,
        2207003,
      );
    }
    return ok({ id: container.id });
  }

  function containerStatus(container: Container, fields: string): Answer {
    if (container.status === "IN_PROGRESS") {
      container.polls += 1;
      if (container.polls >= (options.finishAfterPolls ?? 1)) container.status = "FINISHED";
    }
    const out: Record<string, unknown> = { id: container.id };
    if (fields.includes("status_code") || fields === "") out.status_code = container.status;
    if (/(^|,)status(,|$)/.test(fields)) out.status = container.statusDetail ?? container.status;
    return ok(out);
  }

  function publishContainer(
    account: MockAccount,
    idInPath: string,
    body: Record<string, unknown>,
  ): Answer {
    if (idInPath !== account.id && idInPath !== "me") {
      return error(400, "Unsupported post request. Object does not exist.", 100, 33);
    }
    const container = containers.get(String(body.creation_id ?? ""));
    if (!container || container.accountId !== account.id) {
      return error(400, "Invalid parameter: the media container does not exist.", 100, 2207006);
    }
    if (container.status === "PUBLISHED") {
      return error(400, "The media container has already been published.", 9007, 2207006);
    }
    if (container.status !== "FINISHED") {
      return error(
        400,
        "The media is not ready for publishing, please wait for a moment",
        9007,
        2207027,
      );
    }
    const mediaId = nextId("180");
    const timestamp = now().toISOString();
    media.set(mediaId, {
      id: mediaId,
      accountId: account.id,
      caption: container.caption ?? "",
      timestamp,
      permalink: `https://www.instagram.com/p/MOCK${mediaId}/`,
      containerId: container.id,
      isAiGenerated: container.isAiGenerated === true,
    });
    container.status = "PUBLISHED";
    container.mediaId = mediaId;
    mock.quotaUsage += 1;
    return ok({ id: mediaId });
  }

  return mock;
}

type ErrorFields = { message: string; code?: number; error_subcode?: number; type?: string };

function errorBody(fields: ErrorFields) {
  return {
    message: fields.message,
    type: fields.type ?? "OAuthException",
    code: fields.code ?? 1,
    ...(fields.error_subcode === undefined ? {} : { error_subcode: fields.error_subcode }),
    fbtrace_id: "AMockTrace123",
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === "GET") return {};
  const text = await request.text();
  if (!text) return {};
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text).entries());
}

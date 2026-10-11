import { PermanentError } from "@rc/lib/errors";
import type { Logger } from "@rc/lib/logging";
import { redact } from "@rc/lib/logging";
import type { InstagramApp, InstagramRuntime } from "../core";
import { classifyInstagramError, type FailureSignal, InstagramCallError } from "./errors";

// The one HTTP wrapper for the Graph API (plan 09, M5-01): timeouts, JSON in and out, error
// normalization, path-only logging. The token travels in the `Authorization: Bearer` header
// (V-04) and nowhere else, so it cannot end up in a URL, a log line or a trace.

export const DEFAULT_TIMEOUT_MS = 30_000;

export type GraphParams = Record<string, string | number | boolean | undefined>;

/** What the wrapper tells the caller about one finished call, for the `publish_attempts` audit. */
export type GraphCallRecord = {
  method: "GET" | "POST";
  /** Path after the version, never the query string: `/1784/media`. */
  endpoint: string;
  /** Redacted parameters (no token; presigned URLs scrubbed). */
  request: Record<string, unknown>;
  httpStatus: number | undefined;
  /** Redacted JSON answer. */
  response: Record<string, unknown> | undefined;
  durationMs: number;
  ok: boolean;
  error: InstagramCallError | undefined;
};

export type GraphClientOptions = {
  accessToken: string;
  logger: Logger;
  /** Called after every call, success or failure, before the result is returned or thrown. */
  onCall?: (record: GraphCallRecord) => void | Promise<void>;
  timeoutMs?: number;
};

export type GraphClient = {
  get<T = Record<string, unknown>>(path: string, params?: GraphParams): Promise<T>;
  post<T = Record<string, unknown>>(path: string, params?: GraphParams): Promise<T>;
};

/** The Meta app of the context, or a clear error while publishing is switched off. */
export function requireInstagramApp(rt: InstagramRuntime): InstagramApp {
  if (!rt.app) {
    throw new PermanentError(
      "Instagram is not configured in this environment (INSTAGRAM_PUBLISH_MODE=off).",
    );
  }
  return rt.app;
}

const clean = (params: GraphParams | undefined): Record<string, string | number | boolean> =>
  Object.fromEntries(
    Object.entries(params ?? {}).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
    ),
  );

/** `/1784/media?fields=a,b` → `/1784/media`. */
export const pathOnly = (path: string): string => path.split("?")[0] ?? path;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createGraphClient(rt: InstagramRuntime, options: GraphClientOptions): GraphClient {
  const app = requireInstagramApp(rt);
  const doFetch = rt.fetch ?? fetch;
  const base = `${app.graphBaseUrl.replace(/\/+$/, "")}/${app.graphApiVersion}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    method: "GET" | "POST",
    rawPath: string,
    params: GraphParams | undefined,
  ): Promise<T> {
    const endpoint = pathOnly(rawPath);
    const values = clean(params);
    const url = new URL(`${base}${endpoint}`);
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.accessToken}`,
      accept: "application/json",
    };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (method === "GET") {
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
    } else {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(values);
    }

    const started = Date.now();
    let httpStatus: number | undefined;
    let body: unknown;
    let signal: FailureSignal | undefined;
    try {
      const response = await doFetch(url, init);
      httpStatus = response.status;
      const text = await response.text();
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: { message: `Not a JSON answer (HTTP ${response.status}).` } };
        signal = { httpStatus: response.status, body };
      }
      if (!signal && !response.ok) signal = { httpStatus: response.status, body };
      if (!signal && asRecord(body)?.error !== undefined) {
        signal = { httpStatus: response.status, body };
      }
    } catch (cause) {
      // No answer: the request may or may not have reached Meta. For a POST that is ambiguous.
      signal = { network: true };
      body = undefined;
      options.logger.warn(
        { method, endpoint, err: cause instanceof Error ? cause.name : "error" },
        "graph call got no answer",
      );
    }

    const durationMs = Date.now() - started;
    const failure = signal
      ? new InstagramCallError(classifyInstagramError(signal), {
          ambiguous: method === "POST" && signal.network === true,
        })
      : undefined;
    const record: GraphCallRecord = {
      method,
      endpoint,
      request: redact(values) as Record<string, unknown>,
      httpStatus,
      response: redact(asRecord(body)) as Record<string, unknown> | undefined,
      durationMs,
      ok: !failure,
      error: failure,
    };
    options.logger.debug(
      {
        method,
        endpoint,
        httpStatus,
        durationMs,
        ...(failure
          ? { classification: failure.error.classification, code: failure.error.code }
          : {}),
      },
      "graph call",
    );
    await options.onCall?.(record);
    if (failure) throw failure;
    return body as T;
  }

  return {
    get: (path, params) => call("GET", path, params),
    post: (path, params) => call("POST", path, params),
  };
}

/** `https://api.instagram.com` for the code exchange; the mock serves everything on one host. */
export function oauthBaseUrl(app: InstagramApp): string {
  return app.graphBaseUrl === "https://graph.instagram.com"
    ? "https://api.instagram.com"
    : app.graphBaseUrl.replace(/\/+$/, "");
}

/** The Instagram authorize page (the mock has its own in E2E). */
export function authorizeUrl(app: InstagramApp): string {
  return app.graphBaseUrl === "https://graph.instagram.com"
    ? "https://www.instagram.com/oauth/authorize"
    : `${app.graphBaseUrl.replace(/\/+$/, "")}/oauth/authorize`;
}

/**
 * Calls an OAuth endpoint outside the versioned Graph API (code exchange, long-lived exchange,
 * refresh). These take the secret or token as form fields or query by design; nothing is logged
 * but the path. Failures are classified like any other call.
 */
export async function oauthCall<T>(
  rt: InstagramRuntime,
  logger: Logger,
  request: {
    method: "GET" | "POST";
    /** Base URL + path, e.g. `${oauthBaseUrl(app)}/oauth/access_token`. */
    url: string;
    params: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<T> {
  const doFetch = rt.fetch ?? fetch;
  const url = new URL(request.url);
  const init: RequestInit = {
    method: request.method,
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
  if (request.method === "GET") {
    for (const [key, value] of Object.entries(request.params)) url.searchParams.set(key, value);
  } else {
    init.body = new URLSearchParams(request.params);
  }
  const endpoint = url.pathname;
  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch (cause) {
    logger.warn(
      { endpoint, err: cause instanceof Error ? cause.name : "error" },
      "oauth call got no answer",
    );
    throw new InstagramCallError(classifyInstagramError({ network: true }));
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = undefined;
  }
  // The code exchange reports errors as { error_type, code, error_message } instead of { error }.
  const alt = asRecord(body);
  if (!response.ok || alt?.error !== undefined || alt?.error_type !== undefined) {
    const normalized =
      alt?.error_message !== undefined
        ? { error: { message: String(alt.error_message), code: alt.code, type: alt.error_type } }
        : body;
    const error = classifyInstagramError({ httpStatus: response.status, body: normalized });
    logger.info(
      { endpoint, httpStatus: response.status, classification: error.classification },
      "oauth call failed",
    );
    throw new InstagramCallError(error);
  }
  logger.debug({ endpoint, httpStatus: response.status }, "oauth call");
  return body as T;
}

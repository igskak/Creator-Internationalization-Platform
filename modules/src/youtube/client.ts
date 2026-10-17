import { PermanentError } from "@rc/lib/errors";
import type { Logger } from "@rc/lib/logging";
import type { YouTubeApp, YouTubeRuntime } from "../core";
import { classifyYouTubeError, YouTubeCallError, type YouTubeFailureSignal } from "./errors";

// The one HTTP wrapper for YouTube (task G-09): OAuth refresh, JSON calls of the Data API v3 and
// the resumable upload protocol (verified 2026-10-17, V-31). The refresh token, the access token
// and the upload session URI are secrets: they travel only in headers or as the request URL and
// are never logged or returned in an error; logs name the operation, not the URL.

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const API_BASE = "https://www.googleapis.com/youtube/v3";
export const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
/** Upload a Short and read the channel and the video's processing state. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;
const TIMEOUT_MS = 30_000;
/** A ≤ 30 s Reel is a few tens of MB; the PUT gets more time than a JSON call. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** What the session answered about the bytes it holds. */
export type UploadAnswer =
  | { kind: "done"; videoId: string; uploadStatus: string | undefined }
  | { kind: "incomplete"; received: number }
  | { kind: "expired" };

export type YouTubeClient = {
  /** A GET of the Data API, e.g. `get("/channels", { part: "id", mine: "true" })`. */
  get<T = Record<string, unknown>>(path: string, query: Record<string, string>): Promise<T>;
  /** Starts a resumable upload with the video resource; returns the session URI (a secret). */
  startUpload(input: {
    resource: Record<string, unknown>;
    bytes: number;
    contentType: string;
    notifySubscribers: boolean;
  }): Promise<string>;
  /** Sends `bytes[offset…]` into the session. */
  putBytes(session: string, bytes: Uint8Array, offset: number): Promise<UploadAnswer>;
  /** Asks the session how much it has (an empty PUT with `Content-Range: bytes *\/total`). */
  queryUpload(session: string, total: number): Promise<UploadAnswer>;
};

/** The channel of the context, or a clear error while uploads are switched off. */
export function requireYouTubeApp(rt: YouTubeRuntime): YouTubeApp {
  if (!rt.app) {
    throw new PermanentError(
      "YouTube is not configured in this environment (YOUTUBE_PUBLISH_MODE=off).",
    );
  }
  return rt.app;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: `Not a JSON answer (HTTP ${response.status}).` } };
  }
}

/** `Range: bytes=0-999` → 1000 bytes received; no header → none. */
export function receivedBytes(range: string | null): number {
  const match = range ? /bytes=0-(\d+)/.exec(range) : null;
  return match?.[1] ? Number(match[1]) + 1 : 0;
}

export function createYouTubeClient(rt: YouTubeRuntime, logger: Logger): YouTubeClient {
  const app = requireYouTubeApp(rt);
  const doFetch = rt.fetch ?? fetch;
  let accessToken: { value: string; expiresAt: number } | undefined;

  /** One request; `op` names it in the logs and errors (never the URL, which may be a session). */
  async function send(
    op: string,
    url: string,
    init: RequestInit,
    timeoutMs = TIMEOUT_MS,
  ): Promise<Response> {
    const started = Date.now();
    try {
      const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      logger.debug(
        { op, httpStatus: response.status, durationMs: Date.now() - started },
        "youtube call",
      );
      return response;
    } catch (cause) {
      logger.warn(
        { op, err: cause instanceof Error ? cause.name : "error" },
        "youtube call got no answer",
      );
      const signal: YouTubeFailureSignal = { network: true };
      // Only a request that may have changed something is ambiguous.
      throw new YouTubeCallError(classifyYouTubeError(signal), {
        ambiguous: init.method === "PUT" || init.method === "POST",
      });
    }
  }

  async function fail(response: Response): Promise<never> {
    throw new YouTubeCallError(
      classifyYouTubeError({ httpStatus: response.status, body: await readJson(response) }),
    );
  }

  async function token(): Promise<string> {
    if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
    const response = await send("oauth.refresh", TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        refresh_token: app.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!response.ok) return fail(response);
    const body = (await readJson(response)) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") {
      throw new YouTubeCallError({
        message: "Google answered the token refresh without an access token.",
        classification: "UNKNOWN",
      });
    }
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
    accessToken = { value: body.access_token, expiresAt: Date.now() + seconds * 1000 };
    return accessToken.value;
  }

  async function uploadAnswer(response: Response): Promise<UploadAnswer> {
    if (response.status === 200 || response.status === 201) {
      const video = (await readJson(response)) as {
        id?: unknown;
        status?: { uploadStatus?: unknown };
      };
      if (typeof video.id !== "string") {
        throw new YouTubeCallError({
          message: "YouTube finished the upload without a video id.",
          classification: "UNKNOWN",
        });
      }
      const uploadStatus = video.status?.uploadStatus;
      return {
        kind: "done",
        videoId: video.id,
        uploadStatus: typeof uploadStatus === "string" ? uploadStatus : undefined,
      };
    }
    if (response.status === 308) {
      return { kind: "incomplete", received: receivedBytes(response.headers.get("range")) };
    }
    if (response.status === 404 || response.status === 410) return { kind: "expired" };
    return fail(response);
  }

  return {
    async get(path, query) {
      const url = new URL(`${API_BASE}${path}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      const response = await send(`GET ${path}`, url.toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${await token()}`, accept: "application/json" },
      });
      if (!response.ok) return fail(response);
      return (await readJson(response)) as never;
    },

    async startUpload({ resource, bytes, contentType, notifySubscribers }) {
      const url = new URL(UPLOAD_URL);
      url.searchParams.set("uploadType", "resumable");
      url.searchParams.set("part", Object.keys(resource).join(","));
      url.searchParams.set("notifySubscribers", String(notifySubscribers));
      const response = await send("upload.start", url.toString(), {
        method: "POST",
        headers: {
          authorization: `Bearer ${await token()}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(bytes),
          "x-upload-content-type": contentType,
        },
        body: JSON.stringify(resource),
      });
      if (!response.ok) return fail(response);
      const session = response.headers.get("location");
      if (!session?.startsWith("https://")) {
        throw new YouTubeCallError({
          message: "YouTube started the upload without a session address.",
          classification: "UNKNOWN",
        });
      }
      return session;
    },

    async putBytes(session, bytes, offset) {
      const total = bytes.byteLength;
      const part = offset === 0 ? bytes : bytes.subarray(offset);
      const headers: Record<string, string> = {
        authorization: `Bearer ${await token()}`,
        "content-type": "video/mp4",
      };
      if (offset > 0) headers["content-range"] = `bytes ${offset}-${total - 1}/${total}`;
      const response = await send(
        "upload.put",
        session,
        // A Uint8Array is a valid fetch body at runtime; the web app's DOM typings are stricter.
        { method: "PUT", headers, body: part as unknown as NonNullable<RequestInit["body"]> },
        UPLOAD_TIMEOUT_MS,
      );
      return uploadAnswer(response);
    },

    async queryUpload(session, total) {
      const response = await send("upload.query", session, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${await token()}`,
          "content-range": `bytes */${total}`,
        },
      });
      return uploadAnswer(response);
    },
  };
}

import type { PublishMode, YouTubeRuntime } from "../core";
import { API_BASE, TOKEN_URL, UPLOAD_URL } from "./client";

// An in-memory YouTube for the tests (G-09): the OAuth token endpoint, `channels`, `playlistItems`
// and `videos` of the Data API, and the resumable upload protocol with sessions that can lose an
// answer or expire. No network; nothing here is a real id or secret.

export const TEST_CHANNEL_ID = "UCtestchannel0000000000a";

type Session = {
  url: string;
  total: number;
  received: number;
  resource: Record<string, unknown>;
  videoId?: string;
  expired?: boolean;
};

type Video = { id: string; title: string; publishedAt: string; polls: number };

export type YouTubeMockOptions = {
  now: () => Date;
  channelId?: string;
  /** The token endpoint answers this OAuth error (e.g. `invalid_grant`). */
  tokenError?: string;
  /** `startUpload` answers 403 with this reason (e.g. `quotaExceeded`). */
  startError?: string;
  /** Reads of `videos` before the video is `processed`. */
  processAfterPolls?: number;
  /** The video is rejected for this reason instead of processed. */
  rejectReason?: string;
};

export type YouTubeMock = ReturnType<typeof newYouTubeMock>;

/** Real video ids are unique across channels and runs: so are these, across mock instances. */
let videoSeq = 0;

export function newYouTubeMock(options: YouTubeMockOptions) {
  const sessions = new Map<string, Session>();
  const videos = new Map<string, Video>();
  const calls: { method: string; op: string; url: string; headers: Record<string, string> }[] = [];
  /** The next data PUT loses its answer: after the bytes arrived, or before. */
  let dropNextPut: "afterReceive" | "beforeReceive" | undefined;
  let seq = 0;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  const error = (status: number, reason: string) =>
    json(status, { error: { code: status, message: reason, errors: [{ reason }] } });
  const videoResource = (id: string) => ({ id, status: { uploadStatus: "uploaded" } });

  function finish(session: Session) {
    videoSeq += 1;
    const id = `vid${videoSeq}`;
    const snippet = session.resource.snippet as { title?: string } | undefined;
    videos.set(id, {
      id,
      title: snippet?.title ?? "",
      publishedAt: options.now().toISOString(),
      polls: 0,
    });
    session.videoId = id;
    session.received = session.total;
    return id;
  }

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const path = `${url.origin}${url.pathname}`;

    if (path === TOKEN_URL) {
      calls.push({ method, op: "token", url: path, headers });
      if (options.tokenError) {
        return json(400, { error: options.tokenError, error_description: "Token refused." });
      }
      return json(200, { access_token: "fake-access-token", expires_in: 3600 });
    }

    if (path.startsWith(API_BASE)) {
      const resource = path.slice(API_BASE.length);
      calls.push({ method, op: `GET ${resource}`, url: path, headers });
      if (headers.authorization !== "Bearer fake-access-token") return error(401, "authError");
      if (resource === "/channels") {
        return json(200, {
          items: [
            {
              id: options.channelId ?? TEST_CHANNEL_ID,
              contentDetails: { relatedPlaylists: { uploads: "UUuploads" } },
            },
          ],
        });
      }
      if (resource === "/playlistItems") {
        return json(200, {
          items: [...videos.values()].reverse().map((v) => ({
            snippet: { title: v.title, publishedAt: v.publishedAt, resourceId: { videoId: v.id } },
          })),
        });
      }
      if (resource === "/videos") {
        const video = videos.get(url.searchParams.get("id") ?? "");
        if (!video) return json(200, { items: [] });
        video.polls += 1;
        const rejected = options.rejectReason !== undefined;
        const processed = video.polls > (options.processAfterPolls ?? 0);
        return json(200, {
          items: [
            {
              id: video.id,
              status: rejected
                ? { uploadStatus: "rejected", rejectionReason: options.rejectReason }
                : { uploadStatus: processed ? "processed" : "uploaded" },
              processingDetails: { processingStatus: processed ? "succeeded" : "processing" },
            },
          ],
        });
      }
      return error(404, "notFound");
    }

    if (path === UPLOAD_URL && method === "POST") {
      calls.push({ method, op: "upload.start", url: path, headers });
      if (options.startError) return error(403, options.startError);
      seq += 1;
      const sessionUrl = `${UPLOAD_URL}?uploadType=resumable&upload_id=session${seq}`;
      sessions.set(sessionUrl, {
        url: sessionUrl,
        total: Number(headers["x-upload-content-length"]),
        received: 0,
        resource: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return new Response(null, { status: 200, headers: { location: sessionUrl } });
    }

    if (method === "PUT") {
      const session = sessions.get(url.toString());
      const range = headers["content-range"];
      const isQuery = range?.startsWith("bytes */") ?? false;
      calls.push({ method, op: isQuery ? "upload.query" : "upload.put", url: path, headers });
      if (!session || session.expired) return new Response(null, { status: 404 });
      if (isQuery) {
        if (session.videoId) return json(201, videoResource(session.videoId));
        return new Response(null, {
          status: 308,
          headers: session.received > 0 ? { range: `bytes=0-${session.received - 1}` } : {},
        });
      }
      const body = init.body as Uint8Array;
      const offset = range ? Number(/bytes (\d+)-/.exec(range)?.[1] ?? 0) : 0;
      if (offset !== session.received) return error(400, "badContentRange");
      if (dropNextPut === "beforeReceive") {
        dropNextPut = undefined;
        throw new TypeError("fetch failed");
      }
      session.received = offset + body.byteLength;
      if (session.received < session.total) {
        return new Response(null, {
          status: 308,
          headers: { range: `bytes=0-${session.received - 1}` },
        });
      }
      const id = finish(session);
      if (dropNextPut === "afterReceive") {
        dropNextPut = undefined;
        throw new TypeError("fetch failed");
      }
      return json(201, videoResource(id));
    }

    return new Response(null, { status: 404 });
  };

  return {
    fetch: fetchImpl as typeof fetch,
    sessions,
    videos,
    calls,
    dropNextPut(when: "afterReceive" | "beforeReceive") {
      dropNextPut = when;
    },
    expireSessions() {
      for (const s of sessions.values()) s.expired = true;
    },
    /** Uploads that sent bytes. */
    puts: () => calls.filter((c) => c.op === "upload.put"),
  };
}

export function youtubeRuntime(
  mock: YouTubeMock,
  over: { publishMode?: PublishMode; marketCode?: string; channelId?: string } = {},
): YouTubeRuntime {
  return {
    publishMode: over.publishMode ?? "live",
    app: {
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "fake-client-secret",
      refreshToken: "fake-refresh-token",
      channelId: over.channelId ?? TEST_CHANNEL_ID,
      marketCode: over.marketCode ?? "en",
    },
    fetch: mock.fetch,
  };
}

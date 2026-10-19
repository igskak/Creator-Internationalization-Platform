import { PermanentError, TransientError, ValidationError } from "../../errors";
import {
  DEFAULT_RATES,
  estimateShotCostUsd,
  PORTRAIT_SIZES,
  type Rates,
  shotDurationRange,
} from "./rates";
import {
  type AwaitOptions,
  DEFAULT_VIDEO_MODEL,
  type GeneratedShot,
  type ShotHandle,
  type ShotRequest,
  type VideoModelId,
  type VideoProvider,
  type VideoResolution,
} from "./types";

// Higgsfield API adapter (plan 18, M8-02; schema checked 2026-10-13 against docs.higgsfield.ai and
// by real calls). Authorization is `Key <id>:<secret>`. A shot is three calls:
//   1. `POST /files/generate-upload-url` {content_type} -> upload_url, upload_headers, public_url;
//      then PUT the picture to upload_url with those headers (no credentials on that request).
//   2. `POST /<model>/image-to-video` with an `Idempotency-Key` header -> request_id, status_url.
//   3. `GET /requests/<id>/status` until completed (or failed, nsfw, canceled); `video.url` is the
//      mp4, downloaded without credentials. The vendor keeps files only temporarily.
// Terms of use, retention and rate limits are still to be read (V-24), see the decision log.

export type HiggsfieldOptions = {
  /** `<key id>:<secret>` as shown once by the Higgsfield console. Never logged. */
  apiKey: string;
  baseUrl?: string;
  model?: VideoModelId;
  rates?: Rates;
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** For tests: the clock used to measure the wait. */
  now?: () => number;
};

type Status = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
type StatusBody = { status?: Status; request_id?: string; video?: { url?: string } };

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_POLL_MS = 8000;

export function createHiggsfieldVideoProvider(options: HiggsfieldOptions): VideoProvider {
  if (!options.apiKey.includes(":")) {
    throw new ValidationError("The Higgsfield key must look like <key id>:<secret>.");
  }
  const baseUrl = (options.baseUrl ?? "https://api.higgsfield.ai").replace(/\/$/, "");
  const defaultModel = options.model ?? DEFAULT_VIDEO_MODEL;
  const rates = options.rates ?? DEFAULT_RATES;
  const maxRetries = options.maxRetries ?? 2;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const authorization = `Key ${options.apiKey}`;
  const delayFor = (attempt: number, retryAfter: string | null) => {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
    return Math.min(8000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
  };

  /** One authenticated JSON call with retries on network errors, 408, 429 and 5xx. */
  async function call(
    method: "GET" | "POST",
    path: string,
    extra: { json?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= maxRetries;
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method,
          headers: {
            authorization,
            ...(extra.json === undefined ? {} : { "content-type": "application/json" }),
            ...extra.headers,
          },
          ...(extra.json === undefined ? {} : { body: JSON.stringify(extra.json) }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (last) {
          throw new TransientError(
            `Higgsfield request failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        await sleep(delayFor(attempt, null));
        continue;
      }
      if (response.ok) return response;
      const detail = await errorText(response);
      const details = { status: response.status, path };
      if (response.status === 429 || response.status >= 500 || response.status === 408) {
        if (last) {
          const retryAfter = Number(response.headers.get("retry-after"));
          throw new TransientError(`Higgsfield error ${response.status}: ${detail}`, {
            rateLimited: response.status === 429,
            ...(Number.isFinite(retryAfter) && retryAfter > 0
              ? { retryAfterMs: retryAfter * 1000 }
              : {}),
            details,
          });
        }
        await sleep(delayFor(attempt, response.headers.get("retry-after")));
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new PermanentError("Higgsfield rejected the credentials.", { details });
      }
      if (response.status === 402) {
        throw new PermanentError("The Higgsfield balance is too low for this shot.", {
          details: { ...details, code: "payment_required" },
        });
      }
      throw new PermanentError(`Higgsfield rejected the request (${response.status}): ${detail}`, {
        details,
      });
    }
  }

  async function upload(image: ShotRequest["image"]): Promise<string> {
    const response = await call("POST", "/files/generate-upload-url", {
      json: { content_type: image.mimeType },
    });
    const slot = (await response.json()) as {
      upload_url?: string;
      upload_headers?: Record<string, string>;
      public_url?: string;
    };
    if (!slot.upload_url || !slot.public_url) {
      throw new PermanentError("Higgsfield returned no upload slot.");
    }
    let put: Response;
    try {
      // No credentials on the presigned storage URL.
      put = await doFetch(slot.upload_url, {
        method: "PUT",
        headers: slot.upload_headers ?? { "content-type": image.mimeType },
        body: Buffer.from(image.bytes),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new TransientError(
        `Uploading the picture to Higgsfield failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (!put.ok) {
      throw new TransientError(`Uploading the picture to Higgsfield failed (${put.status}).`, {
        details: { status: put.status },
      });
    }
    return slot.public_url;
  }

  async function submit(request: ShotRequest): Promise<ShotHandle> {
    const model = request.model ?? defaultModel;
    const resolution = request.resolution ?? "720p";
    validate(request, model);
    const imageUrl = await upload(request.image);
    const response = await call("POST", `/${model}/image-to-video`, {
      json: shotBody(
        model,
        imageUrl,
        request.prompt.trim(),
        request.durationSeconds,
        resolution,
        request.audio === true,
      ),
      headers: { "idempotency-key": request.idempotencyKey },
    });
    const body = (await response.json()) as { request_id?: string };
    if (!body.request_id) throw new PermanentError("Higgsfield returned no request id.");
    return {
      requestId: body.request_id,
      model,
      durationSeconds: request.durationSeconds,
      resolution,
    };
  }

  async function waitFor(handle: ShotHandle, wait: AwaitOptions = {}): Promise<GeneratedShot> {
    const timeoutMs = wait.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollMs = wait.pollMs ?? DEFAULT_POLL_MS;
    const started = now();
    for (;;) {
      wait.signal?.throwIfAborted();
      const response = await call(
        "GET",
        `/requests/${encodeURIComponent(handle.requestId)}/status`,
      );
      const body = (await response.json()) as StatusBody;
      const details = { requestId: handle.requestId, model: handle.model };
      switch (body.status) {
        case "completed": {
          const url = body.video?.url;
          if (!url) throw new PermanentError("Higgsfield finished without a video.", { details });
          const bytes = await download(url, details);
          const { width, height } = PORTRAIT_SIZES[handle.resolution];
          return {
            bytes,
            mimeType: "video/mp4",
            width,
            height,
            durationSeconds: handle.durationSeconds,
            model: handle.model,
            providerRequestId: handle.requestId,
            costUsd: estimateShotCostUsd(
              handle.model,
              handle.durationSeconds,
              handle.resolution,
              rates,
            ),
            params: {
              model: handle.model,
              durationSeconds: handle.durationSeconds,
              resolution: handle.resolution,
            },
          };
        }
        case "nsfw":
          throw new PermanentError("Higgsfield blocked the shot (moderation).", {
            details: { ...details, code: "nsfw" },
          });
        case "failed":
        case "canceled":
          throw new PermanentError(`Higgsfield ended the shot as ${body.status}.`, {
            details: { ...details, code: body.status },
          });
        default:
          break; // queued, in_progress or an unknown state: keep waiting
      }
      if (now() - started + pollMs > timeoutMs) {
        throw new TransientError("Higgsfield is still working on the shot.", {
          details: { ...details, code: "timeout" },
        });
      }
      await sleep(pollMs);
    }
  }

  async function download(url: string, details: Record<string, unknown>): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await doFetch(url, { signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      throw new TransientError(
        `Downloading the shot failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, details },
      );
    }
    if (!response.ok) {
      throw new TransientError(`Downloading the shot failed (${response.status}).`, {
        details: { ...details, status: response.status },
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // An mp4 starts with a box whose type, bytes 4 to 8, is `ftyp`.
    if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") {
      throw new PermanentError("The downloaded shot is not an mp4 file.", { details });
    }
    return bytes;
  }

  return {
    id: "higgsfield",
    model: defaultModel,
    submit,
    waitFor,
    async generate(request, wait) {
      return waitFor(await submit(request), wait);
    },
  };
}

function validate(request: ShotRequest, model: VideoModelId): void {
  if (!request.prompt.trim()) throw new ValidationError("A shot needs a prompt.");
  if (!request.idempotencyKey.trim()) throw new ValidationError("A shot needs an idempotency key.");
  if (request.image.bytes.length === 0) throw new ValidationError("A shot needs a picture.");
  const { min, max } = shotDurationRange(model);
  if (
    !Number.isInteger(request.durationSeconds) ||
    request.durationSeconds < min ||
    request.durationSeconds > max
  ) {
    throw new ValidationError(`${model} makes shots of ${min} to ${max} whole seconds.`);
  }
}

/** The request body of each model (checked against the playground snippets, 2026-10-13). */
function shotBody(
  model: VideoModelId,
  imageUrl: string,
  prompt: string,
  duration: number,
  resolution: VideoResolution,
  audio = false,
): Record<string, unknown> {
  switch (model) {
    case "alibaba/wan-3.0":
      return {
        image_url: imageUrl,
        prompt,
        duration,
        resolution,
        aspect_ratio: "adaptive",
        generate_audio: audio,
        enable_thinking: false,
      };
    case "bytedance/seedance-2.0":
      return { image_url: imageUrl, prompt, duration, resolution, generate_audio: audio };
    case "kling-video/v3.0/std":
      return {
        image_url: imageUrl,
        prompt,
        duration,
        sound: audio ? "on" : "off",
        cfg_scale: 0.5,
        multi_shots: false,
      };
  }
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown };
    const detail = body.detail ?? body.message;
    if (typeof detail === "string") return detail.slice(0, 200);
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}

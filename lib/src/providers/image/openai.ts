import { PermanentError, TransientError, ValidationError } from "../../errors";
import type { GeneratedImage, ImageAspect, ImageProvider, ImageRequest } from "./types";

// OpenAI Images adapter (plan 01 D-10, V-19 image part verified 2026-10-10 against
// developers.openai.com/api/docs/guides/image-generation): `POST /v1/images/generations` with a
// gpt-image model, `size` `1024x1536` (portrait), `1024x1024` or `1536x1024`, `quality`, and
// `output_format`; the answer carries `data[0].b64_json`. There is no negative prompt, so it is
// added to the prompt as an "Avoid:" sentence. A moderation block comes as
// `error.code = "moderation_blocked"` and is permanent for that prompt.

export const OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare";

export type ImageQuality = "low" | "medium" | "high" | "xhigh" | "max" | "auto";

/** Portrait first: a 4:5 slot is generated as 2:3 and cropped to the slot (08 §8.4). */
const SIZES: Record<ImageAspect, { size: string; width: number; height: number }> = {
  "4:5": { size: "1024x1536", width: 1024, height: 1536 },
  "3:4": { size: "1024x1536", width: 1024, height: 1536 },
  "1:1": { size: "1024x1024", width: 1024, height: 1024 },
  "16:9": { size: "1536x1024", width: 1536, height: 1024 },
};

/**
 * Estimated USD per image by quality for a portrait image. OpenAI's pricing page lists image
 * tokens, not a per-image table, so these are the published gpt-image-1 per-image figures used as
 * an estimate; override with `prices` once the real bill is known (the bake-off, M3-15).
 */
export const DEFAULT_IMAGE_PRICES: Record<string, number> = {
  low: 0.02,
  medium: 0.07,
  high: 0.19,
  xhigh: 0.3,
  max: 0.4,
};

export type OpenAIImageOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  quality?: ImageQuality;
  prices?: Record<string, number>;
  maxRetries?: number;
  /** Default 180 s: high quality images take a while. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export function createOpenAIImageProvider(options: OpenAIImageOptions): ImageProvider {
  const model = options.model ?? OPENAI_IMAGE_MODEL;
  const quality = options.quality ?? "high";
  const prices = options.prices ?? DEFAULT_IMAGE_PRICES;
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delayFor = (attempt: number, retryAfter: string | null) => {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
    return Math.min(8000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
  };

  return {
    id: "openai",
    model,
    async generate(request: ImageRequest): Promise<GeneratedImage> {
      if (!request.prompt.trim()) throw new ValidationError("An image needs a prompt.");
      const prompt = request.negativePrompt?.trim()
        ? `${request.prompt.trim()}\n\nAvoid: ${request.negativePrompt.trim()}`
        : request.prompt.trim();
      const { size, width, height } = SIZES[request.aspect];
      const params = { model, size, quality, output_format: "png", n: 1 };

      for (let attempt = 0; ; attempt++) {
        const last = attempt >= maxRetries;
        let response: Response;
        try {
          response = await doFetch(`${baseUrl}/images/generations`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify({ ...params, prompt }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          if (last) {
            throw new TransientError(
              `OpenAI images request failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          await sleep(delayFor(attempt, null));
          continue;
        }

        if (response.ok) {
          const body = (await response.json()) as { data?: { b64_json?: string }[] };
          const b64 = body.data?.[0]?.b64_json;
          if (!b64) throw new PermanentError("OpenAI returned no image.");
          return {
            bytes: new Uint8Array(Buffer.from(b64, "base64")),
            mimeType: "image/png",
            width,
            height,
            model,
            costUsd: prices[quality] ?? null,
            params,
          };
        }

        const error = await response
          .json()
          .then((b) => (b as { error?: { message?: string; code?: string } }).error ?? {})
          .catch(() => ({}) as { message?: string; code?: string });
        const details = { status: response.status, ...(error.code ? { code: error.code } : {}) };
        if (response.status === 429 || response.status >= 500 || response.status === 408) {
          if (last) {
            const retryAfter = Number(response.headers.get("retry-after"));
            throw new TransientError(
              `OpenAI images error ${response.status}: ${error.message ?? ""}`,
              {
                rateLimited: response.status === 429,
                ...(Number.isFinite(retryAfter) && retryAfter > 0
                  ? { retryAfterMs: retryAfter * 1000 }
                  : {}),
                details,
              },
            );
          }
          await sleep(delayFor(attempt, response.headers.get("retry-after")));
          continue;
        }
        throw new PermanentError(
          error.code === "moderation_blocked"
            ? "OpenAI blocked the prompt (moderation)."
            : `OpenAI rejected the image request (${response.status}): ${error.message ?? ""}`,
          { details },
        );
      }
    },
  };
}

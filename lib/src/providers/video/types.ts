// Video provider interface (plan 18 §18.4, M8-02): one image-to-video shot per request.

/** Models of the Higgsfield API we use for shots (`POST /<model>/image-to-video`). */
export const VIDEO_MODELS = [
  "alibaba/wan-3.0",
  "kling-video/v3.0/std",
  "bytedance/seedance-2.0",
] as const;
export type VideoModelId = (typeof VIDEO_MODELS)[number];

/** Default after the 2026-10-13 test: cheapest and good enough (docs/design/reel-style.md). */
export const DEFAULT_VIDEO_MODEL: VideoModelId = "alibaba/wan-3.0";

export type VideoResolution = "480p" | "720p" | "1080p";

/** The picture a shot starts from. The caller prepares it as 9:16 (white padding, see the style). */
export type ShotImage = { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" };

export type ShotRequest = {
  prompt: string;
  image: ShotImage;
  /** Whole seconds; each model has its own range (see `shotDurationRange`). */
  durationSeconds: number;
  /** Not used by every model. Default 720p. */
  resolution?: VideoResolution;
  model?: VideoModelId;
  /** Same key, same shot: the vendor does not create or bill a second one. */
  idempotencyKey: string;
  /** A label for fakes and logs, e.g. `scene-3`; never sent to a vendor. */
  label?: string;
};

/**
 * A shot that was accepted by the vendor. Persist all of it (it is small and holds no secret) so a
 * crashed run can resume with `waitFor` without paying twice and still know the cost and size.
 */
export type ShotHandle = {
  requestId: string;
  model: VideoModelId;
  durationSeconds: number;
  resolution: VideoResolution;
};

export type GeneratedShot = {
  /** The finished clip. The vendor keeps files only temporarily, so store it right away. */
  bytes: Uint8Array;
  mimeType: "video/mp4";
  width: number;
  height: number;
  durationSeconds: number;
  model: VideoModelId;
  providerRequestId: string;
  /** List-price estimate in USD (rates before any discount); null when unknown. */
  costUsd: number | null;
  /** What was sent, for `reel_shots.params`. Never contains credentials. */
  params: Record<string, unknown>;
};

export type AwaitOptions = {
  /** Total time to wait for the vendor. Default 10 minutes. */
  timeoutMs?: number;
  /** Time between status checks. Default 8 s. */
  pollMs?: number;
  signal?: AbortSignal;
};

export type VideoProvider = {
  readonly id: "higgsfield" | "fake" | "disabled";
  readonly model: VideoModelId;
  /** Uploads the picture and submits the shot; idempotent by `idempotencyKey`. */
  submit(request: ShotRequest): Promise<ShotHandle>;
  /**
   * Waits for a submitted shot and downloads it. Times out with a TransientError that carries
   * the request id in `details`, so the caller can wait again later without paying twice.
   */
  waitFor(handle: ShotHandle, options?: AwaitOptions): Promise<GeneratedShot>;
  /** `submit` and `waitFor` in one call. */
  generate(request: ShotRequest, options?: AwaitOptions): Promise<GeneratedShot>;
};

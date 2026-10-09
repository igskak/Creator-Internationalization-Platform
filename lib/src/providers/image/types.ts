// Image provider interface (plan 01 D-10, 08 §8.4, M3-03).

/** Aspects the visual director may ask for (`VisualBrief.slides[].aspect`). */
export type ImageAspect = "4:5" | "1:1" | "3:4" | "16:9";

export type ImageRequest = {
  prompt: string;
  /** What must not appear. Models without a negative prompt get it as an "avoid" sentence. */
  negativePrompt?: string;
  aspect: ImageAspect;
  /** A label for fakes and logs, e.g. `hero`; never sent to a vendor. */
  label?: string;
};

export type GeneratedImage = {
  /** The image as the provider returned it (PNG unless `mimeType` says otherwise). */
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  /** The model that made it (recorded in `visual_assets.model`). */
  model: string;
  /** Estimated cost of this image in USD; null when unknown. */
  costUsd: number | null;
  /** What was sent, for `visual_assets.params`. */
  params: Record<string, unknown>;
};

export type ImageProvider = {
  readonly id: "openai" | "fake";
  readonly model: string;
  generate(request: ImageRequest): Promise<GeneratedImage>;
};

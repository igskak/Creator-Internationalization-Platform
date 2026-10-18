// Fixed numbers of the Reel format (docs/design/reel-style.md, plan 18 §18.4 step 3). The renderer,
// its checks and its input hash read them from here.

/** Part of the input hash: bump it when the filter graph, the card layout or the encoder profile changes. */
export const RENDERER_VERSION = "1.1.0";

export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;
/** 120 BPM: a beat is half a second. */
export const SECONDS_PER_BEAT = 0.5;

/** A picture in the RIGHT layout: a box flush with the right edge, top at 307 px (reel-style.md). */
export const BOX = { width: 907, height: 1613, left: 173, top: 307 } as const;

/**
 * AI video models leave a grey cast; levels at 0.9 bring the background back to white. Since
 * carousel v3 (CV-08, R2) the assembly measures each clip's page colour and lifts only the
 * highlights from that level (`PAGE_LEVEL`); 0.9 stays the fallback when a frame cannot be read.
 */
export const WHITE_LIFT = 0.9;

/** The measured page level of a clip is used within these bounds (0–1 of full white). */
export const PAGE_LEVEL = { min: 0.75, max: 1, knee: 0.7 } as const;

/** The text card (reel-style.md "Text cards"). */
export const CARD = {
  left: 70,
  top: 240,
  /** Column width: 1080 − 70 − 230 (the right 230 px stay clear for Instagram's buttons). */
  width: 780,
  maxFontPx: 128,
  minFontPx: 92,
  /** Below the minimum only when a card cannot fit otherwise; the QA report warns. */
  floorFontPx: 72,
  stepPx: 4,
  maxLines: 3,
  fadeSeconds: 0.12,
  ink: "#111111",
  accent: "#E1251B",
} as const;

/** Safe zone on 1080 × 1920: nothing above y = 230 or below y = 1440; the right 230 px stay clear. */
export const SAFE_ZONE = { top: 230, bottom: 1440, right: WIDTH - 230 } as const;

/** The flash opener (variant B): four short shots under the hook card in the first 0.88 s. */
export const FLASH = { shots: 4, shotSeconds: 0.22, clipOffsetSeconds: 0.6 } as const;

/** Instagram's Reel ceiling for a video the first release makes (plan 18 §18.4). */
export const MAX_SECONDS = 30;

export const ENCODER = {
  crf: 18,
  preset: "medium",
  audioBitrate: "160k",
} as const;

import { z } from "zod";

// JSON column shapes of 0014_youtube_shorts (task G-09, docs/design/youtube-shorts.md).

export const YOUTUBE_PRIVACY_STATUSES = ["private", "unlisted", "public"] as const;
export type YouTubePrivacyStatus = (typeof YOUTUBE_PRIVACY_STATUSES)[number];

/** youtube_uploads.metadata: what was (or, for a dry run, would have been) sent with the video. */
export const YouTubeMetadata = z.object({
  title: z.string().min(1).max(100),
  description: z.string(),
  tags: z.array(z.string()),
  categoryId: z.string().min(1),
  defaultLanguage: z.string().min(2),
  privacyStatus: z.enum(YOUTUBE_PRIVACY_STATUSES),
  selfDeclaredMadeForKids: z.boolean(),
  containsSyntheticMedia: z.boolean(),
});
export type YouTubeMetadata = z.infer<typeof YouTubeMetadata>;

export const YOUTUBE_ERROR_CLASSES = [
  "TRANSIENT",
  "RATE_LIMIT",
  "AUTH",
  "PERMISSION",
  "INVALID_MEDIA",
  "PERMANENT",
  "UNKNOWN",
] as const;

/** youtube_uploads.last_error: a YouTube API failure, with no token or session URI in it. */
export const YouTubeError = z.object({
  httpStatus: z.number().int().optional(),
  /** Google's `error.errors[0].reason`, e.g. `quotaExceeded`, or the OAuth `error`. */
  reason: z.string().optional(),
  type: z.string().optional(),
  message: z.string(),
  classification: z.enum(YOUTUBE_ERROR_CLASSES),
});
export type YouTubeError = z.infer<typeof YouTubeError>;

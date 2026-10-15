import { z } from "zod";
import type { GraphClient } from "./http";

// The Graph API calls of publishing (plan 09 §9.9), typed. Every Meta endpoint, parameter and
// field name for publishing lives here and nowhere else (CLAUDE.md: Instagram specifics only in
// modules/instagram). A reply that does not have the expected shape is a ZodError: the machine
// treats it like a transient failure.

export const CONTAINER_STATUSES = [
  "IN_PROGRESS",
  "FINISHED",
  "PUBLISHED",
  "ERROR",
  "EXPIRED",
] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

const Id = z.object({ id: z.string().min(1) });
const Status = z.object({
  id: z.string().optional(),
  status_code: z.enum(CONTAINER_STATUSES),
  // Some replies carry a human-readable reason next to ERROR.
  status: z.string().optional(),
});
const MediaInfo = z.object({
  id: z.string().optional(),
  permalink: z.string().url().optional(),
  timestamp: z.string().optional(),
});
const RecentMedia = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        caption: z.string().optional(),
        timestamp: z.string().optional(),
        permalink: z.string().optional(),
      }),
    )
    .default([]),
});
const Limit = z.object({
  data: z
    .array(
      z.object({
        quota_usage: z.number().int().nonnegative().optional(),
        config: z.object({ quota_total: z.number().int().nonnegative().optional() }).optional(),
      }),
    )
    .optional(),
});
const Me = z.object({ followers_count: z.number().int().nonnegative().optional() });

/** One slide as a carousel child: Meta downloads `imageUrl` itself. Returns the container id. */
export async function createChildContainer(
  client: GraphClient,
  accountId: string,
  imageUrl: string,
): Promise<string> {
  const reply = Id.parse(
    await client.post(`/${accountId}/media`, { image_url: imageUrl, is_carousel_item: true }),
  );
  return reply.id;
}

/** The carousel container. `isAiGenerated` applies Instagram's AI info label (V-16, carousel only). */
export async function createCarouselContainer(
  client: GraphClient,
  accountId: string,
  input: { childIds: readonly string[]; caption: string; isAiGenerated?: boolean },
): Promise<string> {
  const reply = Id.parse(
    await client.post(`/${accountId}/media`, {
      media_type: "CAROUSEL",
      children: input.childIds.join(","),
      caption: input.caption,
      ...(input.isAiGenerated ? { is_ai_generated: true } : {}),
    }),
  );
  return reply.id;
}

/**
 * A Reel container (V-25, checked 2026-10-15): Meta downloads `videoUrl` itself, after it answers,
 * so a bad link shows up later as status ERROR. `share_to_feed` puts it on the grid as well as in
 * the Reels tab. `isAiGenerated` is Instagram's AI info label, as for carousels. `trialGraduation`
 * makes it a trial Reel (IG User Media reference, `trial_params`, read 2026-10-15).
 */
export async function createReelContainer(
  client: GraphClient,
  accountId: string,
  input: {
    videoUrl: string;
    caption: string;
    shareToFeed?: boolean;
    isAiGenerated?: boolean;
    /** A trial Reel (M8-11): sent as `trial_params`, JSON of `{ graduation_strategy }`. */
    trialGraduation?: "MANUAL" | "SS_PERFORMANCE" | null;
  },
): Promise<string> {
  const reply = Id.parse(
    await client.post(`/${accountId}/media`, {
      media_type: "REELS",
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: input.shareToFeed ?? true,
      ...(input.isAiGenerated ? { is_ai_generated: true } : {}),
      ...(input.trialGraduation
        ? { trial_params: JSON.stringify({ graduation_strategy: input.trialGraduation }) }
        : {}),
    }),
  );
  return reply.id;
}

export async function getContainerStatus(
  client: GraphClient,
  containerId: string,
): Promise<{ status: ContainerStatus; detail: string | undefined }> {
  // `status` carries Meta's reason next to ERROR (e.g. "... error code 2207026").
  const reply = Status.parse(await client.get(`/${containerId}`, { fields: "status_code,status" }));
  return { status: reply.status_code, detail: reply.status };
}

/** `media_publish`: the call that makes the post public. Returns the media id. */
export async function publishContainer(
  client: GraphClient,
  accountId: string,
  containerId: string,
): Promise<string> {
  const reply = Id.parse(
    await client.post(`/${accountId}/media_publish`, { creation_id: containerId }),
  );
  return reply.id;
}

export async function getMedia(
  client: GraphClient,
  mediaId: string,
): Promise<{ permalink: string | undefined; timestamp: string | undefined }> {
  const reply = MediaInfo.parse(
    await client.get(`/${mediaId}`, { fields: "id,permalink,timestamp" }),
  );
  return { permalink: reply.permalink, timestamp: reply.timestamp };
}

export type RecentMediaItem = {
  id: string;
  caption?: string | undefined;
  timestamp?: string | undefined;
  permalink?: string | undefined;
};

export async function listRecentMedia(
  client: GraphClient,
  accountId: string,
  limit = 10,
): Promise<RecentMediaItem[]> {
  const reply = RecentMedia.parse(
    await client.get(`/${accountId}/media`, { fields: "id,caption,timestamp,permalink", limit }),
  );
  return reply.data;
}

/** Posts made through the API in the last 24 h and the allowance (V-06: 100). */
export async function getPublishingLimit(
  client: GraphClient,
  accountId: string,
): Promise<{ used: number; total: number } | undefined> {
  const entry = Limit.parse(
    await client.get(`/${accountId}/content_publishing_limit`, { fields: "quota_usage,config" }),
  ).data?.[0];
  return entry?.quota_usage !== undefined && entry.config?.quota_total !== undefined
    ? { used: entry.quota_usage, total: entry.config.quota_total }
    : undefined;
}

export async function getFollowerCount(client: GraphClient): Promise<number | undefined> {
  return Me.parse(await client.get("/me", { fields: "followers_count" })).followers_count;
}

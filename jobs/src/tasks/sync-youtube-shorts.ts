import { cronHandlerTask } from "../handler-task";
import { youtubePublishQueue } from "../queues";

/**
 * J25 (task G-09): one published Reel to YouTube Shorts per run, hourly at :37. Off unless
 * YOUTUBE_PUBLISH_MODE and `youtube.enabled` allow it. Up to 20 minutes (it waits for YouTube's
 * processing), five attempts from 1 to 10 minutes; a retried run resumes the same upload.
 */
export const syncYouTubeShorts = cronHandlerTask("sync-youtube-shorts", "37 * * * *", {
  queue: youtubePublishQueue,
  maxDuration: 20 * 60,
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 60_000, maxTimeoutInMs: 600_000 },
});

import { handlerTask } from "../handler-task";
import { renderQueue } from "../queues";

/**
 * J23 (plan 06 §6.2, plan 18 §18.4): the Reel pipeline of one variant. Chromium draws the cards and
 * ffmpeg assembles the video, so a large machine and up to 25 minutes (the vendor's queue alone
 * can take ten). Retries resume at the stage that stopped; finished shots are never paid twice.
 */
export const generateReel = handlerTask("generate-reel", {
  queue: renderQueue,
  machine: "large-1x",
  maxDuration: 25 * 60,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 15_000, maxTimeoutInMs: 120_000 },
});

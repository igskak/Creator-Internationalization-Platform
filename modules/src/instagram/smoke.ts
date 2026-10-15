import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import { PRESIGN_TTL } from "@rc/lib/providers/storage";
import type { ServiceContext } from "../core";
import { decryptAccessToken } from "./accounts";
import {
  type ContainerStatus,
  createCarouselContainer,
  createChildContainer,
  createReelContainer,
  getContainerStatus,
  getMedia,
  getPublishingLimit,
  publishContainer,
} from "./api";
import { InstagramCallError } from "./errors";
import { createGraphClient, type GraphCallRecord, requireInstagramApp } from "./http";

// The smoke test of one Instagram account (plan 13 §13.6 item 4, M5-10): the same calls the
// publisher makes, on synthetic slides, with the verdicts the open verification items need
// (V-14 presigned links, V-08 a second media_publish, V-06 the allowance). Dry by default: nothing
// is posted unless `live` is set. Nothing is written to the database. With `video` it posts a Reel
// instead of a carousel (M8-09: V-26, a presigned link to an mp4).

export type SmokeStep = {
  name: string;
  ok: boolean;
  skipped: boolean;
  detail: string;
  durationMs: number;
};

export type SmokeReport = {
  accountId: string;
  username: string;
  instagramAccountId: string;
  live: boolean;
  /** A Reel was tried instead of a carousel. */
  reel: boolean;
  mode: string;
  startedAt: string;
  steps: SmokeStep[];
  /** Evidence for the open verification items, in words. */
  findings: string[];
  /** What was posted, if anything. */
  permalink: string | null;
  mediaId: string | null;
  passed: boolean;
  /** The calls made, redacted: for the log of the run. */
  calls: {
    method: string;
    endpoint: string;
    httpStatus: number | undefined;
    ok: boolean;
    ms: number;
  }[];
  /** What a person must still do by hand. */
  cleanup: string[];
};

export type SmokeInput = {
  socialAccountId: string;
  /** Post for real (the test post is public until it is deleted by hand). */
  live: boolean;
  /** After a live post, call `media_publish` once more on the same container to learn what Meta answers (V-08). */
  probeRepublish?: boolean;
  /** 2–10 JPEG images, 1080 × 1350 (the CLI makes them). Ignored when `video` is set. */
  slides: readonly Uint8Array[];
  /** An mp4 (H.264 + AAC, 9:16): the smoke test makes a REELS container from it instead. */
  video?: Uint8Array;
  /** How long to wait for the container (default 10 minutes, 15 for a Reel). */
  maxWaitMs?: number;
};

const CAPTION = (iso: string) =>
  `Smoke test ${iso.slice(0, 16).replace("T", " ")} UTC. Please ignore, this post is deleted by hand.\n\n#smoketest`;

export async function runInstagramSmoke(
  ctx: ServiceContext,
  input: SmokeInput,
): Promise<SmokeReport> {
  const app = requireInstagramApp(ctx.instagram);
  const [account] = await ctx.db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, input.socialAccountId));
  if (!account) throw new NotFoundError("Social account not found.");

  const started = ctx.clock.now();
  const report: SmokeReport = {
    accountId: account.id,
    username: account.username,
    instagramAccountId: account.instagramAccountId,
    live: input.live,
    reel: input.video !== undefined,
    mode: ctx.instagram.publishMode,
    startedAt: started.toISOString(),
    steps: [],
    findings: [],
    permalink: null,
    mediaId: null,
    passed: false,
    calls: [],
    cleanup: [],
  };
  const uploaded: string[] = [];

  const record = (call: GraphCallRecord) => {
    report.calls.push({
      method: call.method,
      endpoint: call.endpoint,
      httpStatus: call.httpStatus,
      ok: call.ok,
      ms: call.durationMs,
    });
  };

  /** Runs one step; a failure is recorded and ends the run (later steps depend on it). */
  async function step<T>(name: string, run: () => Promise<{ detail: string; value: T }>) {
    const t0 = Date.now();
    try {
      const { detail, value } = await run();
      report.steps.push({ name, ok: true, skipped: false, detail, durationMs: Date.now() - t0 });
      return value;
    } catch (error) {
      const detail =
        error instanceof InstagramCallError
          ? `${error.error.classification}${error.error.code ? ` (code ${error.error.code}${error.error.subcode ? `/${error.error.subcode}` : ""})` : ""}: ${error.error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      report.steps.push({ name, ok: false, skipped: false, detail, durationMs: Date.now() - t0 });
      return undefined;
    }
  }
  const skip = (name: string, detail: string) =>
    report.steps.push({ name, ok: true, skipped: true, detail, durationMs: 0 });
  const failed = () => report.steps.some((s) => !s.ok);

  try {
    // 1. The environment lets this account be used.
    await step("environment", async () => {
      const problems: string[] = [];
      if (ctx.instagram.publishMode === "off") problems.push("INSTAGRAM_PUBLISH_MODE is off.");
      if (input.live && ctx.instagram.publishMode !== "live") {
        problems.push("A live smoke test needs INSTAGRAM_PUBLISH_MODE=live.");
      }
      if (!app.accountAllowlist.includes(account.instagramAccountId)) {
        problems.push("The account is not in INSTAGRAM_ACCOUNT_ALLOWLIST.");
      }
      if (account.status !== "ACTIVE") problems.push(`The account is ${account.status}.`);
      if (problems.length > 0) throw new Error(problems.join(" "));
      return {
        detail: `mode ${ctx.instagram.publishMode}, @${account.username} (${account.instagramAccountId}) is allowed`,
        value: true,
      };
    });
    if (failed()) return finish();

    const client = createGraphClient(ctx.instagram, {
      accessToken: decryptAccessToken(ctx, account),
      logger: ctx.logger,
      onCall: record,
    });

    // 2. The token works and the account is professional.
    await step("token and profile", async () => {
      const me = (await client.get("/me", { fields: "user_id,username,account_type" })) as {
        username?: string;
        account_type?: string;
      };
      return {
        detail: `@${me.username ?? "?"}, ${me.account_type ?? "?"}, token expires ${account.tokenExpiresAt?.toISOString() ?? "unknown"}`,
        value: me,
      };
    });
    if (failed()) return finish();

    // 3. The publishing allowance (V-06).
    await step("publishing limit", async () => {
      const quota = await getPublishingLimit(client, account.instagramAccountId);
      report.findings.push(
        quota
          ? `V-06: content_publishing_limit answers quota_usage=${quota.used}, config.quota_total=${quota.total}.`
          : "V-06: content_publishing_limit answered without quota_usage / config.quota_total: the fields differ from the docs.",
      );
      return {
        detail: quota
          ? `${quota.used} of ${quota.total} posts in 24 h`
          : "no quota fields in the answer",
        value: quota,
      };
    });

    const prefix = `smoke/${randomUUID()}`;
    let containerId: string | undefined;
    if (input.video) {
      // 4. A Reel: the mp4 in storage, presigned like in production, one REELS container (V-26).
      const video = input.video;
      containerId = await step("reel container", async () => {
        const key = `${prefix}/reel.mp4`;
        await ctx.storage.put(key, video, { contentType: "video/mp4" });
        uploaded.push(key);
        const { url } = await ctx.storage.presignGet(key, {
          expiresInSeconds: PRESIGN_TTL.metaFetch,
        });
        const id = await createReelContainer(client, account.instagramAccountId, {
          videoUrl: url,
          caption: CAPTION(report.startedAt),
          shareToFeed: true,
        });
        return { detail: `REELS container ${id} from a presigned mp4 link`, value: id };
      });
      if (!containerId) return finish();
    } else {
      // 4. Slides in storage, presigned like in production, and one child container each (V-14).
      const children = await step("child containers", async () => {
        const ids: string[] = [];
        for (const [i, bytes] of input.slides.entries()) {
          const key = `${prefix}/${i}.jpg`;
          await ctx.storage.put(key, bytes, { contentType: "image/jpeg" });
          uploaded.push(key);
          const { url } = await ctx.storage.presignGet(key, {
            expiresInSeconds: PRESIGN_TTL.metaFetch,
          });
          ids.push(await createChildContainer(client, account.instagramAccountId, url));
        }
        report.findings.push(
          `V-14: Instagram accepted ${ids.length} presigned image links as image_url (query strings included).`,
        );
        return { detail: `${ids.length} children created from presigned links`, value: ids };
      });
      if (!children) {
        report.findings.push(
          "V-14: a child container could not be made from a presigned link. If the message says the image could not be downloaded, Meta does not accept presigned URLs: set RENDERS_PUBLIC_BASE_URL (plan 09 §9.3).",
        );
        return finish();
      }

      // 5. The carousel container and its readiness.
      containerId = await step("carousel container", async () => {
        const id = await createCarouselContainer(client, account.instagramAccountId, {
          childIds: children,
          caption: CAPTION(report.startedAt),
        });
        return { detail: `container ${id}`, value: id };
      });
      if (!containerId) return finish();
    }
    const container = containerId;

    const finished = await step("container ready", async () => {
      const limit = input.maxWaitMs ?? (input.video ? 15 : 10) * 60_000;
      let waited = 0;
      let status: ContainerStatus = "IN_PROGRESS";
      let detail: string | undefined;
      while (waited <= limit) {
        ({ status, detail } = await getContainerStatus(client, container));
        if (status !== "IN_PROGRESS") break;
        await ctx.sleep(30_000);
        waited += 30_000;
      }
      if (status !== "FINISHED") {
        if (input.video) {
          report.findings.push(
            `V-26: the REELS container ended ${status}${detail ? ` (${detail})` : ""}. If Meta could not download the video (2207052 / 2207003), presigned links do not work for video: set RENDERS_PUBLIC_BASE_URL.`,
          );
        }
        throw new Error(
          `The container is ${status} after ${waited / 1000} s${detail ? `: ${detail}` : ""}.`,
        );
      }
      report.findings.push(
        input.video
          ? `V-26: Meta downloaded the video from a presigned R2 link; the REELS container reached FINISHED after about ${waited / 1000} s.`
          : `V-07: the container reached FINISHED after about ${waited / 1000} s.`,
      );
      return { detail: `FINISHED after about ${waited / 1000} s`, value: true };
    });
    if (!finished) return finish();

    if (!input.live) {
      skip("publish", "dry run: the container is left to expire (about 24 h), nothing is posted");
      skip("permalink", "dry run");
      skip("insights", "dry run");
      return finish();
    }

    // 6. Publish for real, read the permalink, and try the insights call.
    const mediaId = await step("publish", async () => {
      const id = await publishContainer(client, account.instagramAccountId, container);
      return { detail: `media ${id}`, value: id };
    });
    if (!mediaId) return finish();
    report.mediaId = mediaId;
    report.cleanup.push(
      `Delete the test post by hand in the Instagram app (the API cannot delete media, V-15): media ${mediaId}.`,
    );

    await step("permalink", async () => {
      const media = await getMedia(client, mediaId);
      report.permalink = media.permalink ?? null;
      return { detail: media.permalink ?? "no permalink in the answer", value: media };
    });

    if (input.probeRepublish) {
      try {
        const again = await publishContainer(client, account.instagramAccountId, container);
        report.findings.push(
          `V-08: a second media_publish of the same container was ACCEPTED and returned media ${again}${again === mediaId ? " (the same id)" : " (a different id: a duplicate post exists!)"}.`,
        );
        if (again !== mediaId)
          report.cleanup.push(`Delete the duplicate post (media ${again}) by hand.`);
      } catch (error) {
        report.findings.push(
          `V-08: a second media_publish of the same container was REFUSED: ${error instanceof InstagramCallError ? `${error.error.classification}, code ${error.error.code ?? "?"}/${error.error.subcode ?? "?"}: ${error.error.message}` : String(error)}.`,
        );
      }
    }

    await step("insights", async () => {
      try {
        await client.get(`/${mediaId}/insights`, {
          metric: "reach,likes,comments,saved,shares,total_interactions",
        });
        report.findings.push("V-10: the media insights call answered for a fresh carousel.");
        return { detail: "the insights call answered", value: true };
      } catch (error) {
        // Fresh posts often have no insights yet: that is not a failure of the smoke test.
        const text = error instanceof InstagramCallError ? error.error.message : String(error);
        report.findings.push(`V-10: the media insights call failed right after posting: ${text}`);
        return { detail: `not available yet (${text})`, value: false };
      }
    });
    return finish();
  } finally {
    for (const key of uploaded) await ctx.storage.delete(key).catch(() => {});
  }

  function finish(): SmokeReport {
    report.passed = report.steps.length > 0 && report.steps.every((s) => s.ok);
    if (!input.live) {
      report.cleanup.push("Nothing was posted. The unused container expires by itself.");
    }
    return report;
  }
}

/** The report as the text pasted into the runbook's log. */
export function formatSmokeReport(report: SmokeReport): string {
  const lines = [
    `# Instagram smoke test${report.reel ? " (Reel)" : ""} — @${report.username}`,
    "",
    `- Started: ${report.startedAt}`,
    `- Mode: ${report.mode}${report.live ? " (LIVE: a public test post was made)" : " (dry run)"}`,
    `- Result: ${report.passed ? "PASSED" : "FAILED"}`,
    "",
    "## Steps",
    ...report.steps.map(
      (s) =>
        `- ${s.skipped ? "SKIP" : s.ok ? "OK  " : "FAIL"} ${s.name}: ${s.detail} (${s.durationMs} ms)`,
    ),
  ];
  if (report.findings.length > 0)
    lines.push(
      "",
      "## Findings for the verification list",
      ...report.findings.map((f) => `- ${f}`),
    );
  if (report.permalink) lines.push("", `Post: ${report.permalink}`);
  lines.push(
    "",
    "## Calls",
    ...report.calls.map(
      (c) => `- ${c.method} ${c.endpoint} → ${c.httpStatus ?? "no answer"} (${c.ms} ms)`,
    ),
  );
  if (report.cleanup.length > 0)
    lines.push("", "## To do by hand", ...report.cleanup.map((c) => `- ${c}`));
  return lines.join("\n");
}

/**
 * Synthetic slides for the smoke test: plain 1080 × 1350 JPEGs with a number, nothing from the
 * brand's content (the smoke post is public until it is deleted). Needs `sharp`.
 */
export async function makeSmokeSlides(count = 3): Promise<Uint8Array[]> {
  const { default: sharp } = await import("sharp");
  const colors = ["#f4e3c1", "#cfe3d4", "#d7d7ee", "#f2cfd0", "#d8e6ef"];
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      sharp({
        create: {
          width: 1080,
          height: 1350,
          channels: 3,
          background: colors[i % colors.length] ?? "#ffffff",
        },
      })
        .composite([
          {
            input: Buffer.from(
              `<svg width="1080" height="1350" xmlns="http://www.w3.org/2000/svg"><text x="540" y="720" font-size="240" font-family="sans-serif" text-anchor="middle" fill="#333">${i + 1}</text></svg>`,
            ),
          },
        ])
        .jpeg({ quality: 80 })
        .toBuffer()
        .then((buffer) => new Uint8Array(buffer)),
    ),
  );
}

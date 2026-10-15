import { schema } from "@rc/db";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createMemoryStorage } from "@rc/lib/providers/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext } from "../core";
import { formatSmokeReport, makeSmokeSlides, runInstagramSmoke } from "./smoke";
import {
  capturingLogger,
  connectTestAccount,
  instagramFixture,
  mockRuntime,
  newMock,
} from "./test-support";

// The smoke test of an account against the mock Graph API (M5-10).

const ES = "1784";

describe("Instagram smoke test", () => {
  let t: TestDb;
  let mock: ReturnType<typeof newMock>;
  let ctx: ReturnType<typeof createServiceContext>;
  let accountId: string;
  let storage: ReturnType<typeof createMemoryStorage>;
  const slides = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];

  async function setup(
    over: { mode?: "live" | "dry_run_only" | "off"; allowlist?: string[] } = {},
  ) {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    mock = newMock({ accounts: [{ id: ES, username: "kitchen_es" }] });
    const base = await instagramFixture(t.db, mock);
    storage = createMemoryStorage();
    ctx = createServiceContext({
      db: t.db,
      logger: capturingLogger().logger,
      clock: base.clock,
      storage,
      instagram: mockRuntime(mock, {
        publishMode: over.mode ?? "live",
        allowlist: over.allowlist ?? [ES],
      }),
      sleep: async (ms) => base.clock.advance(ms),
      actor: { type: "SYSTEM" },
    });
    accountId = (
      await connectTestAccount(ctx, mock, {
        marketId: base.marketIds["es-ES"] as string,
        accountId: ES,
        username: "kitchen_es",
      })
    ).account.id;
  }
  beforeEach(async () => {
    await setup();
  });
  afterEach(async () => {
    await t.close();
  });

  it("a Reel dry run makes a REELS container from a presigned mp4 and posts nothing", async () => {
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: false,
      slides: [],
      video: new Uint8Array([0, 0, 0, 24]),
    });
    expect(report.passed).toBe(true);
    expect(report.reel).toBe(true);
    expect(report.steps.map((s) => s.name)).toEqual([
      "environment",
      "token and profile",
      "publishing limit",
      "reel container",
      "container ready",
      "publish",
      "permalink",
      "insights",
    ]);
    const post = mock.calls.find((c) => c.method === "POST" && c.path.endsWith("/media"));
    expect(post?.body).toMatchObject({ media_type: "REELS", share_to_feed: true });
    expect(String(post?.body.video_url)).toContain("reel.mp4");
    expect(report.findings.join("\n")).toMatch(/V-26: Meta downloaded the video/);
    expect(mock.publishedMedia()).toHaveLength(0);
    expect(storage.keys()).toEqual([]);
    expect(formatSmokeReport(report)).toContain("smoke test (Reel)");
  });

  it("a Reel whose video Meta cannot fetch fails with the V-26 hint", async () => {
    mock.options.unfetchableUrlPart = "reel.mp4";
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: false,
      slides: [],
      video: new Uint8Array([0, 0, 0, 24]),
    });
    expect(report.passed).toBe(false);
    expect(report.steps.at(-1)).toMatchObject({ name: "container ready", ok: false });
    expect(report.findings.join("\n")).toMatch(/V-26: the REELS container ended ERROR.*2207052/);
  });

  it("a dry run goes as far as the finished container and posts nothing", async () => {
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: false,
      slides,
    });
    expect(report.passed).toBe(true);
    expect(report.steps.map((s) => [s.name, s.skipped ? "skip" : s.ok ? "ok" : "fail"])).toEqual([
      ["environment", "ok"],
      ["token and profile", "ok"],
      ["publishing limit", "ok"],
      ["child containers", "ok"],
      ["carousel container", "ok"],
      ["container ready", "ok"],
      ["publish", "skip"],
      ["permalink", "skip"],
      ["insights", "skip"],
    ]);
    expect(mock.publishedMedia()).toHaveLength(0);
    expect(report.mediaId).toBeNull();
    expect(report.findings.join("\n")).toMatch(/V-06.*quota_usage=0.*quota_total=100/);
    expect(report.findings.join("\n")).toMatch(/V-14: Instagram accepted 3 presigned image links/);
    expect(report.calls.every((c) => c.ok)).toBe(true);
    expect(report.cleanup[0]).toMatch(/Nothing was posted/);
    // The fixture images are removed from storage again.
    expect(storage.keys()).toEqual([]);
    // Nothing is written to the publications tables.
    expect(await t.db.select().from(schema.publications)).toEqual([]);
    expect(await t.db.select().from(schema.publishAttempts)).toEqual([]);
  });

  it("a live run posts once, reads the permalink, records what a second media_publish does, and says what to delete", async () => {
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: true,
      probeRepublish: true,
      slides,
    });
    expect(report.passed).toBe(true);
    expect(mock.publishedMedia()).toHaveLength(1);
    expect(report.mediaId).toBe(mock.publishedMedia()[0]?.id);
    expect(report.permalink).toContain("instagram.com/p/");
    expect(report.findings.join("\n")).toMatch(/V-08: a second media_publish .* REFUSED/);
    expect(report.cleanup.join("\n")).toMatch(/Delete the test post by hand .*V-15/);
    expect(mock.callsTo(/media_publish$/, "POST")).toHaveLength(2);
    expect(mock.publishedMedia()).toHaveLength(1);
    const text = formatSmokeReport(report);
    expect(text).toContain("Result: PASSED");
    expect(text).toContain("LIVE");
    expect(text).not.toMatch(/igl-\d+/); // no token anywhere in the log
  });

  it("notes a duplicate if Meta accepts a second publish", async () => {
    // A mock that forgets a container is published, to play Meta accepting the call.
    const original = mock.handle;
    mock.handle = async (request) => {
      if (request.method === "POST" && new URL(request.url).pathname.endsWith("/media_publish")) {
        for (const c of mock.containers.values())
          if (c.kind === "CAROUSEL" && c.status === "PUBLISHED") c.status = "FINISHED";
      }
      return original(request);
    };
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: true,
      probeRepublish: true,
      slides,
    });
    expect(report.findings.join("\n")).toMatch(/V-08: .* ACCEPTED .*different id/);
    expect(report.cleanup.join("\n")).toMatch(/duplicate post/);
  });

  it.each([
    ["an account that is not on the allowlist", { allowlist: ["somebody-else"] }, /ALLOWLIST/],
    ["an environment that is off", { mode: "off" as const }, /off/],
  ])("stops at the first step for %s, without a call", async (_name, over, pattern) => {
    await t.close();
    await setup(over);
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: false,
      slides,
    });
    expect(report.passed).toBe(false);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]?.detail).toMatch(pattern);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses a live run in an environment that only allows dry runs", async () => {
    await t.close();
    await setup({ mode: "dry_run_only" });
    const report = await runInstagramSmoke(ctx, { socialAccountId: accountId, live: true, slides });
    expect(report.passed).toBe(false);
    expect(report.steps[0]?.detail).toMatch(/needs INSTAGRAM_PUBLISH_MODE=live/);
    expect(mock.calls).toHaveLength(0);
  });

  it("reports a token Instagram refuses and stops", async () => {
    const [account] = await t.db.select().from(schema.socialAccounts);
    for (const token of mock.tokens.keys()) mock.revokeToken(token);
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: account?.id ?? "",
      live: false,
      slides,
    });
    expect(report.passed).toBe(false);
    expect(report.steps.at(-1)).toMatchObject({ name: "token and profile", ok: false });
    expect(report.steps.at(-1)?.detail).toMatch(/AUTH \(code 190\)/);
  });

  it("explains a refused presigned link (V-14) and what to do", async () => {
    mock.options.unfetchableUrlPart = "/0.jpg";
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: false,
      slides,
    });
    expect(report.passed).toBe(false);
    expect(report.steps.at(-1)).toMatchObject({ name: "child containers", ok: false });
    expect(report.findings.join("\n")).toMatch(/V-14: .*RENDERS_PUBLIC_BASE_URL/);
    expect(storage.keys()).toEqual([]);
  });

  it("gives up on a container that never finishes", async () => {
    mock.options.finishAfterPolls = 10_000;
    const report = await runInstagramSmoke(ctx, {
      socialAccountId: accountId,
      live: true,
      slides,
      maxWaitMs: 60_000,
    });
    expect(report.passed).toBe(false);
    expect(report.steps.at(-1)).toMatchObject({ name: "container ready", ok: false });
    expect(mock.publishedMedia()).toHaveLength(0);
  });

  it("makes real 1080 × 1350 JPEG slides", async () => {
    const made = await makeSmokeSlides(2);
    expect(made).toHaveLength(2);
    const { default: sharp } = await import("sharp");
    for (const bytes of made) {
      const meta = await sharp(bytes).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1080, 1350]);
    }
  });
});

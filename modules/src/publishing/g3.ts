import { schema } from "@rc/db";
import { and, desc, eq, isNotNull } from "@rc/db/orm";
import type { ServiceContext } from "../core";
import type { G2State } from "./g2";
import { isPublishingEnabled } from "./settings";

// What the software can tell about Gate G3, the first live Reel (plan 18 §18.5, M8-09): a Reel dry
// run that reached FINISHED on Meta, an approved Reel waiting, and whether a live Reel exists yet
// (it must not before the owner's decision). V-25, V-26 and the decision itself are people's items,
// recorded in docs/decisions/G3.md.

export type G3Item = { id: number; title: string; state: G2State; details: string[] };
export type G3Readiness = {
  environment: { mode: string; publishingEnabled: boolean };
  items: G3Item[];
  automatedOk: boolean;
};

export async function checkG3Readiness(ctx: ServiceContext): Promise<G3Readiness> {
  // Publications of Reels: their version points at a reel render.
  const reelPublications = await ctx.db
    .select({
      id: schema.publications.id,
      status: schema.publications.status,
      dryRun: schema.publications.dryRun,
      marketCode: schema.markets.code,
      containerStatus: schema.publications.igContainerStatus,
      permalink: schema.publications.permalink,
      updatedAt: schema.publications.updatedAt,
      lastError: schema.publications.lastError,
    })
    .from(schema.publications)
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, schema.publications.contentVariantVersionId),
    )
    .innerJoin(schema.markets, eq(schema.markets.id, schema.publications.marketId))
    .where(isNotNull(schema.contentVariantVersions.reelRenderId))
    .orderBy(desc(schema.publications.updatedAt));
  const approvedReels = await ctx.db
    .select({ id: schema.contentVariants.id })
    .from(schema.contentVariants)
    .where(
      and(eq(schema.contentVariants.format, "REEL"), eq(schema.contentVariants.status, "APPROVED")),
    );
  const publishingEnabled = await isPublishingEnabled(ctx);

  const items: G3Item[] = [];
  items.push({
    id: 1,
    title: "V-25: Instagram's Reels rules checked against the current docs",
    state: "MANUAL",
    details: ["Recorded in docs/plan/decision-log.md (2026-10-15, M8-09)."],
  });

  const dryRuns = reelPublications.filter((p) => p.dryRun);
  const passed = dryRuns.filter((p) => p.status === "DRY_RUN_PASSED");
  const failed = dryRuns.filter((p) => p.status === "FAILED");
  items.push({
    id: 2,
    title: "V-26: a Reel dry run reached FINISHED on the test account (Meta fetched the video)",
    state: passed.length > 0 ? "PASS" : "FAIL",
    details:
      passed.length > 0
        ? passed
            .slice(0, 3)
            .map((p) => `${p.marketCode}: dry run ${p.id} passed ${p.updatedAt.toISOString()}`)
        : [
            failed.length > 0
              ? `No Reel dry run passed; the last failed: ${failed[0]?.lastError?.message ?? "no message"}`
              : "No Reel dry run yet: approve a Reel and press Dry run on its card (or pnpm ig:smoke --reel).",
          ],
  });

  items.push({
    id: 3,
    title: "An approved Reel is waiting for its first live post",
    state: approvedReels.length > 0 ? "PASS" : "FAIL",
    details: [`${approvedReels.length} approved Reel(s) without a post`],
  });

  const live = reelPublications.filter((p) => !p.dryRun && p.status !== "CANCELLED");
  items.push({
    id: 4,
    title:
      "No live Reel before the decision (G3 is not recorded until docs/decisions/G3.md says GO)",
    state: "MANUAL",
    details:
      live.length === 0
        ? ["No live Reel publication exists yet."]
        : live.map(
            (p) => `${p.marketCode}: ${p.status}${p.permalink ? ` ${p.permalink}` : ""} (${p.id})`,
          ),
  });

  return {
    environment: { mode: ctx.instagram.publishMode, publishingEnabled },
    items,
    automatedOk: items.every((i) => i.state !== "FAIL"),
  };
}

/** The readiness as text for `pnpm rc g3-check`. */
export function formatG3Readiness(readiness: G3Readiness): string {
  const mark = { PASS: "PASS  ", FAIL: "FAIL  ", MANUAL: "MANUAL" } as const;
  return [
    `Gate G3 readiness, the first live Reel (mode ${readiness.environment.mode}, publishing ${readiness.environment.publishingEnabled ? "on" : "off"})`,
    "",
    ...readiness.items.flatMap((item) => [
      `${mark[item.state]} ${item.id}. ${item.title}`,
      ...item.details.map((d) => `        - ${d}`),
    ]),
    "",
    readiness.automatedOk
      ? "No automatic check fails. The owner records the decision in docs/decisions/G3.md before the first live Reel."
      : "Some automatic checks fail: see above.",
  ].join("\n");
}

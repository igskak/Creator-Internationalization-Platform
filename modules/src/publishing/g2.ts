import { schema } from "@rc/db";
import { asc, eq, inArray } from "@rc/db/orm";
import type { ServiceContext } from "../core";
import { isPublishingEnabled } from "./settings";

// What the software can tell about Gate G2 (plan 14 §14.3, M5-11): the items that leave a trace in
// the database. The rest (live smoke, the idempotency drill, legal items, ManyChat, Sergey's
// approval) are people's and stay MANUAL; they are recorded in docs/decisions/G2.md.

export const G2_FIRST_POSTS_PER_MARKET = 3;
const REFRESH_FRESH_DAYS = 7;
const DAY_MS = 86_400_000;

export type G2State = "PASS" | "FAIL" | "MANUAL";
export type G2Item = { id: number; title: string; state: G2State; details: string[] };
export type G2Readiness = {
  environment: { mode: string; publishingEnabled: boolean };
  items: G2Item[];
  /** No automatable item fails. The manual ones still need a person. */
  automatedOk: boolean;
};

export async function checkG2Readiness(ctx: ServiceContext): Promise<G2Readiness> {
  const now = ctx.clock.now();
  const markets = await ctx.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.isActive, true))
    .orderBy(asc(schema.markets.sortOrder));
  const accounts = await ctx.db
    .select()
    .from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.platform, "instagram"));
  const active = accounts.filter((a) => a.status === "ACTIVE");
  const audits = await ctx.db
    .select({ action: schema.auditEvents.action, entityId: schema.auditEvents.entityId })
    .from(schema.auditEvents)
    .where(
      inArray(schema.auditEvents.action, [
        "publishing.enabled",
        "publishing.disabled",
        "instagram.token_refreshed",
      ]),
    );
  const publications = await ctx.db
    .select()
    .from(schema.publications)
    .where(inArray(schema.publications.status, ["DRY_RUN_PASSED", "PUBLISHED"]));
  const publishingEnabled = await isPublishingEnabled(ctx);
  const allowlist = ctx.instagram.app?.accountAllowlist ?? [];

  const items: G2Item[] = [];

  items.push({
    id: 1,
    title: "Live smoke test on a test account; idempotency drill (exactly one post)",
    state: "MANUAL",
    details: [
      "Run docs/runbooks/instagram-smoke.md §2 and §3 and log the result in docs/decisions/G2.md.",
    ],
  });

  // 2. A dry run on each production account with a real approved carousel.
  const missingDry = markets.filter((m) => {
    const account = active.find((a) => a.marketId === m.id);
    return (
      !account ||
      !publications.some(
        (p) =>
          p.dryRun &&
          p.status === "DRY_RUN_PASSED" &&
          p.socialAccountId === account.id &&
          p.createdAt >= account.connectedAt,
      )
    );
  });
  items.push({
    id: 2,
    title: "Dry run passed on both production accounts with a real approved carousel",
    state: markets.length > 0 && missingDry.length === 0 ? "PASS" : "FAIL",
    details:
      missingDry.length === 0
        ? markets.map((m) => `${m.displayName}: dry run passed`)
        : missingDry.map(
            (m) =>
              `${m.displayName}: ${active.some((a) => a.marketId === m.id) ? "no dry run passed since the account was connected" : "no connected account"}`,
          ),
  });

  // 3. Kill switch tested, allowlist verified, token refresh run.
  const switchedOff = audits.some((a) => a.action === "publishing.disabled");
  const switchedOn = audits.some((a) => a.action === "publishing.enabled");
  const switchProblems: string[] = [];
  if (!(switchedOff && switchedOn)) {
    switchProblems.push(
      "The kill switch has not been switched off and on again (see the audit trail).",
    );
  }
  const unlisted = active.filter((a) => !allowlist.includes(a.instagramAccountId));
  const unknown = allowlist.filter((id) => !active.some((a) => a.instagramAccountId === id));
  if (active.length === 0) switchProblems.push("No account is connected.");
  for (const a of unlisted)
    switchProblems.push(`@${a.username} is connected but not in INSTAGRAM_ACCOUNT_ALLOWLIST.`);
  for (const id of unknown)
    switchProblems.push(
      `The allowlist has ${id}, which is not a connected account (a test id in production?).`,
    );
  const refreshed = new Set(
    audits.filter((a) => a.action === "instagram.token_refreshed").map((a) => a.entityId),
  );
  for (const a of active) {
    const last = a.tokenLastRefreshedAt ?? a.connectedAt;
    const fresh = now.getTime() - last.getTime() < REFRESH_FRESH_DAYS * DAY_MS;
    if (!refreshed.has(a.id) && !fresh) {
      switchProblems.push(
        `@${a.username}: the token has not been refreshed since ${last.toISOString().slice(0, 10)}.`,
      );
    } else if (!refreshed.has(a.id)) {
      switchProblems.push(
        `@${a.username}: no token refresh has been run yet (run the J13 job by hand once).`,
      );
    }
  }
  items.push({
    id: 3,
    title: "Kill switch tested; allowlist verified; token refresh run",
    state: switchProblems.length === 0 ? "PASS" : "FAIL",
    details:
      switchProblems.length === 0
        ? [
            "Switched off and on in the audit trail",
            `Allowlist = ${allowlist.length} connected account(s)`,
            "Token refresh has run for every account",
          ]
        : switchProblems,
  });

  items.push({
    id: 4,
    title:
      "Legal/compliance items closed (B-13): AI imagery disclosure, privacy policy URL, food-safety claims",
    state: "MANUAL",
    details: [
      "Record the decisions in docs/decisions/G2.md. The disclosure setting is `ai_imagery_disclosure` of each market (M5-12).",
    ],
  });
  items.push({
    id: 5,
    title:
      "ManyChat flows ready for the planned commercial CTAs (or the first posts are non-commercial)",
    state: "MANUAL",
    details: ["Each commercial post's review screen shows its flow name and keyword (M4-11)."],
  });

  // 6. The first three posts per market, published and with a permalink.
  const live = publications.filter((p) => !p.dryRun && p.status === "PUBLISHED");
  const counts = markets.map((m) => {
    const mine = live.filter((p) => p.marketId === m.id);
    return {
      name: m.displayName,
      published: mine.length,
      complete: mine.filter((p) => p.instagramMediaId && p.permalink).length,
    };
  });
  const short = counts.filter((c) => c.complete < G2_FIRST_POSTS_PER_MARKET);
  items.push({
    id: 6,
    title: `Sergey approved the first ${G2_FIRST_POSTS_PER_MARKET} posts per market; they are published with a media id and a permalink`,
    state: markets.length > 0 && short.length === 0 ? "PASS" : "FAIL",
    details: counts.map(
      (c) =>
        `${c.name}: ${c.complete} of ${G2_FIRST_POSTS_PER_MARKET} published with a permalink${c.published > c.complete ? ` (${c.published - c.complete} without one)` : ""}`,
    ),
  });

  return {
    environment: { mode: ctx.instagram.publishMode, publishingEnabled },
    items,
    automatedOk: items.every((i) => i.state !== "FAIL"),
  };
}

/** The readiness as text for `pnpm rc g2-check`. */
export function formatG2Readiness(readiness: G2Readiness): string {
  const mark = { PASS: "PASS  ", FAIL: "FAIL  ", MANUAL: "MANUAL" } as const;
  return [
    `Gate G2 readiness (mode ${readiness.environment.mode}, publishing ${readiness.environment.publishingEnabled ? "on" : "off"})`,
    "",
    ...readiness.items.flatMap((item) => [
      `${mark[item.state]} ${item.id}. ${item.title}`,
      ...item.details.map((d) => `        - ${d}`),
    ]),
    "",
    readiness.automatedOk
      ? "No automatic check fails. The MANUAL items need a person; record everything in docs/decisions/G2.md."
      : "Some automatic checks fail: see above.",
  ].join("\n");
}

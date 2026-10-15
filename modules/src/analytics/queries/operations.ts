import { schema } from "@rc/db";
import { and, desc, eq, gte, inArray, lt, sql } from "@rc/db/orm";
import { z } from "zod";
import type { ServiceContext } from "../../core";
import { type DateRangeInput, num, parseRange } from "./range";

// Operations (11 §11.4): how the production side is doing: how much is generated, how much of it
// a person approves, why the rest is rejected, how much editing an approved post needed, how long
// approval takes, how often the critic passes at the first try, what it costs. Everything is read
// from `review_events`, `audit_events`, `content_variants` and `generation_runs`.

const HOUR = 3_600;

export type Operations = {
  /** Variants that reached review in the window (a variant that is generated again counts once). */
  generated: number;
  approved: number;
  rejected: number;
  /** Approved / (approved + rejected); null when nothing was decided. */
  approvalRate: number | null;
  rejectionReasons: { code: string; count: number }[];
  /** Edits a post got before it was approved, averaged over the posts approved in the window. */
  avgEditsPerApproved: number | null;
  /** From reaching review (or being sent back to it) to the approval; median, in hours. */
  medianTimeToApproveHours: number | null;
  /** Variants whose critic passed with no rewrite / variants with a critic report, created in the window. */
  criticPassRate: number | null;
  criticReports: number;
  /** Regenerations (all fields) per variant that reached review. */
  regenerationsPerVariant: number | null;
  /** Model cost of the posts approved in the window / their number (USD). */
  costPerApprovedPost: number | null;
};

export async function getOperations(ctx: ServiceContext, raw: DateRangeInput): Promise<Operations> {
  const range = parseRange(raw);
  const e = schema.reviewEvents;
  const v = schema.contentVariants;
  const a = schema.auditEvents;
  const market = (column: typeof v.marketId) =>
    range.marketId ? [eq(column, range.marketId)] : [];

  // Decisions in the window, with the variant they belong to.
  const decisions = await ctx.db
    .select({
      variantId: e.contentVariantId,
      action: e.action,
      at: e.createdAt,
      reasonCode: e.reasonCode,
    })
    .from(e)
    .innerJoin(v, eq(v.id, e.contentVariantId))
    .where(
      and(
        inArray(e.action, ["APPROVE", "REJECT"]),
        gte(e.createdAt, range.from),
        lt(e.createdAt, range.to),
        ...market(v.marketId),
      ),
    );
  const approvals = decisions.filter((x) => x.action === "APPROVE");
  const rejections = decisions.filter((x) => x.action === "REJECT");
  const reasons = new Map<string, number>();
  for (const r of rejections) {
    const code = r.reasonCode ?? "NONE";
    reasons.set(code, (reasons.get(code) ?? 0) + 1);
  }

  // Edits before each approval, and the time from review to approval.
  let edits = 0;
  const hours: number[] = [];
  for (const approval of approvals) {
    const [counted] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(e)
      .where(
        and(
          eq(e.contentVariantId, approval.variantId),
          eq(e.action, "EDIT"),
          lt(e.createdAt, approval.at),
        ),
      );
    edits += Number(counted?.n ?? 0);
    const [entered] = await ctx.db
      .select({ at: sql<Date | null>`max(${a.occurredAt})` })
      .from(a)
      .where(
        and(
          eq(a.entityType, "content_variant"),
          eq(a.entityId, approval.variantId),
          inArray(a.action, ["variant.generated", "variant.resubmitted"]),
          lt(a.occurredAt, approval.at),
        ),
      );
    if (entered?.at) {
      hours.push((approval.at.getTime() - new Date(entered.at).getTime()) / 1000 / HOUR);
    }
  }
  hours.sort((x, y) => x - y);
  const middle = Math.floor(hours.length / 2);
  const median =
    hours.length === 0
      ? null
      : hours.length % 2 === 1
        ? (hours[middle] as number)
        : ((hours[middle - 1] as number) + (hours[middle] as number)) / 2;

  // Variants that reached review in the window.
  const generatedRows = await ctx.db
    .selectDistinct({ id: a.entityId })
    .from(a)
    .innerJoin(v, eq(v.id, a.entityId))
    .where(
      and(
        eq(a.action, "variant.generated"),
        gte(a.occurredAt, range.from),
        lt(a.occurredAt, range.to),
        ...market(v.marketId),
      ),
    );
  const generatedIds = generatedRows.flatMap((r) => (r.id ? [r.id] : []));

  const [regenerated] = generatedIds.length
    ? await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(e)
        .where(and(eq(e.action, "REGENERATE"), inArray(e.contentVariantId, generatedIds)))
    : [{ n: 0 }];

  // The critic: variants created in the window that have a report; a first pass is a PASS with no rewrite.
  const [critic] = await ctx.db
    .select({
      reports: sql<number>`count(*)::int`,
      passed: sql<number>`count(*) filter (where ${v.criticReport} ->> 'verdict' = 'PASS' and coalesce((${v.criticReport} ->> 'iteration')::int, 0) = 0)::int`,
    })
    .from(v)
    .where(
      and(
        sql`${v.criticReport} is not null`,
        gte(v.createdAt, range.from),
        lt(v.createdAt, range.to),
        ...market(v.marketId),
      ),
    );

  // What the approved posts cost to make: every model run of their variants.
  const approvedIds = [...new Set(approvals.map((x) => x.variantId))];
  const [cost] = approvedIds.length
    ? await ctx.db
        .select({ total: sql<string | null>`sum(${schema.generationRuns.costUsd})` })
        .from(schema.generationRuns)
        .where(inArray(schema.generationRuns.contentVariantId, approvedIds))
    : [{ total: null }];

  const approved = approvals.length;
  const rejected = rejections.length;
  const reports = Number(critic?.reports ?? 0);
  return {
    generated: generatedIds.length,
    approved,
    rejected,
    approvalRate: approved + rejected === 0 ? null : approved / (approved + rejected),
    rejectionReasons: [...reasons.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((x, y) => y.count - x.count || x.code.localeCompare(y.code)),
    avgEditsPerApproved: approved === 0 ? null : edits / approved,
    medianTimeToApproveHours: median,
    criticPassRate: reports === 0 ? null : Number(critic?.passed ?? 0) / reports,
    criticReports: reports,
    regenerationsPerVariant:
      generatedIds.length === 0 ? null : Number(regenerated?.n ?? 0) / generatedIds.length,
    costPerApprovedPost:
      approved === 0 || num(cost?.total) === null
        ? null
        : (num(cost?.total) as number) / approvedIds.length,
  };
}

/** Rejection reason codes with their labels, for the screen. */
export async function listReasonLabels(ctx: ServiceContext): Promise<Record<string, string>> {
  const rows = await ctx.db
    .select({ code: schema.taxonomyTerms.code, label: schema.taxonomyTerms.label })
    .from(schema.taxonomyTerms)
    .where(eq(schema.taxonomyTerms.kind, "reason_code"))
    .orderBy(desc(schema.taxonomyTerms.sortOrder));
  return Object.fromEntries(rows.map((r) => [r.code, r.label]));
}

export const OperationsInput = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  marketId: z.uuid().optional(),
});

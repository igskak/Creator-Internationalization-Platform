import { schema } from "@rc/db";
import { and, count, eq, inArray, max, min, sql } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import type { ServiceContext } from "../../core";

// The numbers of the M1 acceptance report for one source (plan 14 §14.2, M1-25): pages, cards,
// share of verified quotes, model cost, time and the problems seen. Read-only.

export type SourceReport = {
  title: string;
  type: string;
  attempt: number;
  pages: { total: number; withoutTextLayer: number; transcribed: number };
  batches: { total: number; succeeded: number; failed: number; pdfNative: number; text: number };
  cards: {
    /** Not archived. */
    total: number;
    byStatus: Record<"EXTRACTED" | "NEEDS_REVIEW" | "CHEF_APPROVED" | "ARCHIVED", number>;
    withQuote: number;
    quoteVerified: number;
    /** quoteVerified / withQuote, 0–100. */
    quoteVerifiedPercent: number | null;
    flags: {
      QUOTE_UNVERIFIED: number;
      LOW_CONFIDENCE: number;
      SAFETY_SENSITIVE: number;
      DUPLICATE_SUSPECTED: number;
    };
    averageConfidence: number | null;
    embedded: number;
  };
  runs: {
    total: number;
    byStage: Record<string, number>;
    invalid: number;
    repaired: number;
    inputTokens: number;
    outputTokens: number;
    /** Null when a run had no price (an unknown model). */
    costUsd: number | null;
    /** Sum of the call times, in seconds. */
    modelSeconds: number;
  };
  /** First batch created to last batch updated, in seconds. */
  extractionSeconds: number | null;
  /** Processing started to finished, in seconds, from the audit trail. */
  processingSeconds: number | null;
  /** Problems worth a look: failed batches, errors, invalid runs. */
  issues: string[];
};

const FLAGS = [
  "QUOTE_UNVERIFIED",
  "LOW_CONFIDENCE",
  "SAFETY_SENSITIVE",
  "DUPLICATE_SUSPECTED",
] as const;

export async function getSourceReport(ctx: ServiceContext, id: string): Promise<SourceReport> {
  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, id));
  if (!source) throw new NotFoundError("Source not found.", { details: { id } });
  const attempt = source.processingAttempt;

  const pageWhere = and(
    eq(schema.sourcePages.sourceAssetId, id),
    eq(schema.sourcePages.processingAttempt, attempt),
  );
  const [[pages], batches, cards, runs, events] = await Promise.all([
    ctx.db
      .select({
        total: count(),
        without: sql<number>`count(*) filter (where ${schema.sourcePages.hasTextLayer} = false)`,
        transcribed: sql<number>`count(*) filter (where ${schema.sourcePages.transcribed} = true)`,
      })
      .from(schema.sourcePages)
      .where(pageWhere),
    ctx.db
      .select()
      .from(schema.knowledgeExtractionBatches)
      .where(
        and(
          eq(schema.knowledgeExtractionBatches.sourceAssetId, id),
          eq(schema.knowledgeExtractionBatches.processingAttempt, attempt),
        ),
      ),
    ctx.db.select().from(schema.knowledgeItems).where(eq(schema.knowledgeItems.sourceAssetId, id)),
    ctx.db.select().from(schema.generationRuns).where(eq(schema.generationRuns.sourceAssetId, id)),
    ctx.db
      .select({
        action: schema.auditEvents.action,
        at: schema.auditEvents.occurredAt,
      })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.entityType, "source_asset"),
          eq(schema.auditEvents.entityId, id),
          inArray(schema.auditEvents.action, [
            "source.processing_started",
            "source.processed",
            "source.failed",
          ]),
        ),
      ),
  ]);

  const byStatus = { EXTRACTED: 0, NEEDS_REVIEW: 0, CHEF_APPROVED: 0, ARCHIVED: 0 };
  const live = cards.filter((c) => c.reviewStatus !== "ARCHIVED");
  for (const c of cards) byStatus[c.reviewStatus]++;
  const withQuote = live.filter((c) => c.sourceReference?.quote);
  const verified = withQuote.filter((c) => c.sourceReference?.quoteVerified === true);
  const confidences = live.map((c) => Number(c.confidence)).filter((n) => Number.isFinite(n));

  const byStage: Record<string, number> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let priced = true;
  let latency = 0;
  for (const r of runs) {
    byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    inputTokens += r.usage?.inputTokens ?? 0;
    outputTokens += r.usage?.outputTokens ?? 0;
    if (r.costUsd === null) priced = false;
    else cost += Number(r.costUsd);
    latency += r.latencyMs ?? 0;
  }

  const started = events
    .filter((e) => e.action === "source.processing_started")
    .map((e) => e.at.getTime());
  const finished = events
    .filter((e) => e.action !== "source.processing_started")
    .map((e) => e.at.getTime());
  const lastStart = started.length ? Math.max(...started) : null;
  const lastFinish = finished.length ? Math.max(...finished) : null;
  const processingSeconds =
    lastStart !== null && lastFinish !== null && lastFinish >= lastStart
      ? Math.round((lastFinish - lastStart) / 1000)
      : null;
  const created = batches.map((b) => b.createdAt.getTime());
  const updated = batches.map((b) => b.updatedAt.getTime());
  const extractionSeconds = batches.length
    ? Math.round((Math.max(...updated) - Math.min(...created)) / 1000)
    : null;

  const failedBatches = batches.filter((b) => b.status === "FAILED");
  const issues: string[] = [];
  if (source.processingError)
    issues.push(`Source error ${source.processingError.code}: ${source.processingError.message}`);
  for (const b of failedBatches) {
    issues.push(
      `Batch ${b.batchIndex} (pages ${b.pageStart}–${b.pageEnd}) failed: ${b.error?.code ?? "unknown"}`,
    );
  }
  const invalid = runs.filter(
    (r) => r.status === "INVALID_OUTPUT" || r.status === "REFUSED",
  ).length;
  if (invalid > 0) issues.push(`${invalid} model call(s) ended invalid or refused`);
  if ((pages?.without ?? 0) > 0) issues.push(`${pages?.without} page(s) without a text layer`);

  return {
    title: source.title,
    type: source.type,
    attempt,
    pages: {
      total: Number(pages?.total ?? 0),
      withoutTextLayer: Number(pages?.without ?? 0),
      transcribed: Number(pages?.transcribed ?? 0),
    },
    batches: {
      total: batches.length,
      succeeded: batches.filter((b) => b.status === "SUCCEEDED").length,
      failed: failedBatches.length,
      pdfNative: batches.filter((b) => b.mode === "PDF_NATIVE").length,
      text: batches.filter((b) => b.mode === "TEXT").length,
    },
    cards: {
      total: live.length,
      byStatus,
      withQuote: withQuote.length,
      quoteVerified: verified.length,
      quoteVerifiedPercent: withQuote.length
        ? Math.round((verified.length / withQuote.length) * 1000) / 10
        : null,
      flags: Object.fromEntries(
        FLAGS.map((flag) => [flag, live.filter((c) => c.reviewFlags.includes(flag)).length]),
      ) as SourceReport["cards"]["flags"],
      averageConfidence: confidences.length
        ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
        : null,
      embedded: live.filter((c) => c.embedding !== null).length,
    },
    runs: {
      total: runs.length,
      byStage,
      invalid,
      repaired: runs.filter((r) => r.status === "REPAIRED" || r.repairAttempts > 0).length,
      inputTokens,
      outputTokens,
      costUsd: priced ? Math.round(cost * 10_000) / 10_000 : null,
      modelSeconds: Math.round(latency / 1000),
    },
    extractionSeconds,
    processingSeconds,
    issues,
  };
}

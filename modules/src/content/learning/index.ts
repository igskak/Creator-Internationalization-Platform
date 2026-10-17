import { schema } from "@rc/db";
import type { PerformanceMemory } from "@rc/db/json";
import { PerformanceMemory as PerformanceMemorySchema } from "@rc/db/json";
import { and, desc, eq, isNotNull, sql } from "@rc/db/orm";
import type { contentWriter } from "@rc/prompts";
import { STAGE_CONFIG } from "../../ai";
import type { ServiceContext } from "../../core";
import type { Exemplar } from "../voice";

// How the performance memory reaches generation (plan 11 §11.5, M7-04). The summaries are built by
// analytics (J15); content only reads the newest row, so it does not depend on analytics. Whether
// the memory is used at all follows the active prompt versions: idea-generator@3 and
// content-writer@6 have the rules for it, earlier versions do not get it.

const DAY_MS = 86_400_000;
/** An older summary is not used: the numbers would mislead more than help. */
export const MAX_MEMORY_AGE_DAYS = 30;
const MAX_D7_EXEMPLARS = 2;
const MAX_EXEMPLAR_CHARS = 1200;

/** The first prompt versions with the rules for the memory. */
export const IDEA_MEMORY_VERSION = 3;
export const WRITER_LEARNING_VERSION = 6;
/**
 * Writer versions that read `<learning>`. content-writer@7 (carousel v3) is built on v5 on purpose:
 * the learning waits for D7 numbers (decision log 2026-10-15), so it is not switched on by v7.
 */
export const WRITER_LEARNING_VERSIONS: ReadonlySet<number> = new Set([WRITER_LEARNING_VERSION]);
export const ideasUseMemory = (version: number = STAGE_CONFIG.IDEA_GENERATION.version) =>
  version >= IDEA_MEMORY_VERSION;
export const writerUsesLearning = (version: number = STAGE_CONFIG.CONTENT_WRITING.version) =>
  WRITER_LEARNING_VERSIONS.has(version);

export type LoadedMemory = { summaryId: string; memory: PerformanceMemory };

/** The newest summary of a market (null = across markets) if it is recent and well formed. */
export async function latestMemory(
  ctx: ServiceContext,
  marketId: string | null,
): Promise<LoadedMemory | null> {
  const p = schema.performanceSummaries;
  const [row] = await ctx.db
    .select({ id: p.id, createdAt: p.createdAt, memory: p.summaryJson })
    .from(p)
    .where(marketId ? eq(p.marketId, marketId) : sql`${p.marketId} is null`)
    .orderBy(desc(p.createdAt))
    .limit(1);
  if (!row) return null;
  if (ctx.clock.now().getTime() - row.createdAt.getTime() > MAX_MEMORY_AGE_DAYS * DAY_MS)
    return null;
  const parsed = PerformanceMemorySchema.safeParse(row.memory);
  return parsed.success ? { summaryId: row.id, memory: parsed.data } : null;
}

/** The memory as the idea generator reads it: compact JSON without the empty lists. */
export function memoryForIdeas(memory: PerformanceMemory): string {
  const { feedback, ...rest } = memory;
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (Array.isArray(value) && value.length === 0) continue;
    compact[key] = value;
  }
  const fb = Object.fromEntries(Object.entries(feedback).filter(([, v]) => v.length > 0));
  if (Object.keys(fb).length > 0) compact.feedback = fb;
  return JSON.stringify(compact);
}

const times = (n: number) => n.toFixed(2).replace(/\.?0+$/u, "");

/**
 * What the writer of one market learns from its memory: hook types that did better or worse at
 * day 7 (advice), and the reasons drafts were sent back (an avoid list, with the reasons' labels).
 */
export function writerLearning(
  memory: PerformanceMemory,
  labels: { hookType: (code: string) => string; reason: (code: string) => string },
): contentWriter.WriterLearning {
  const metric = (m: string) => (m === "save_rate" ? "save rate" : "share rate");
  const line = (p: PerformanceMemory["topPatterns"][number], better: boolean) =>
    `${labels.hookType(p.value)} hooks did ${better ? "better" : "worse"}: ${times(p.lift)}× the market's ${metric(p.metric)} (${p.n} posts, ${p.confidence} confidence).`;
  return {
    hookGuidance: [
      ...memory.topPatterns.filter((p) => p.dimension === "hook_type").map((p) => line(p, true)),
      ...memory.weakPatterns.filter((p) => p.dimension === "hook_type").map((p) => line(p, false)),
    ].slice(0, 6),
    avoid: memory.feedback.topRejectionReasons
      .map(
        (r) =>
          `${labels.reason(r.code)} (sent back ${r.count} ${r.count === 1 ? "time" : "times"} lately)`,
      )
      .slice(0, 6),
  };
}

/** The labels of hook types and rejection reasons, for `writerLearning`. */
export async function learningLabels(ctx: ServiceContext) {
  const rows = await ctx.db
    .select({
      kind: schema.taxonomyTerms.kind,
      code: schema.taxonomyTerms.code,
      label: schema.taxonomyTerms.label,
    })
    .from(schema.taxonomyTerms);
  const of = (kind: string) =>
    new Map(rows.filter((r) => r.kind === kind).map((r) => [r.code, r.label]));
  const hooks = of("hook_type");
  const reasons = of("reason_code");
  return {
    hookType: (code: string) => hooks.get(code) ?? code,
    reason: (code: string) => reasons.get(code) ?? code,
  };
}

/**
 * The market's best posts by save rate at day 7 (M7-04 "exemplars by D7"): hook and caption as
 * ordinary examples, so the writer sees what the audience kept.
 */
export async function topExemplarsByD7(
  ctx: ServiceContext,
  marketId: string,
  limit = MAX_D7_EXEMPLARS,
): Promise<Exemplar[]> {
  const d = schema.vPublicationDimensions;
  const m = schema.vPublicationMetricsD7;
  const rows = await ctx.db
    .select({ hook: schema.contentVariants.hook, caption: schema.contentVariants.caption })
    .from(d)
    .innerJoin(m, eq(m.publicationId, d.publicationId))
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, d.variantId))
    .where(and(eq(d.marketId, marketId), eq(d.format, "CAROUSEL"), isNotNull(m.saveRate)))
    .orderBy(desc(m.saveRate), desc(d.publishedAt))
    .limit(limit);
  return rows.map((r) => ({
    kind: "EXEMPLAR" as const,
    text: `Hook: ${r.hook ?? ""}\nCaption: ${r.caption ?? ""}`.slice(0, MAX_EXEMPLAR_CHARS),
    note: "One of the market's best posts by save rate at day 7.",
  }));
}

import { schema } from "@rc/db";
import { and, count, desc, eq, gte, inArray, lt } from "@rc/db/orm";
import { z } from "zod";
import type { ServiceContext } from "../../core";
import { num } from "./range";
import { pickShown, type ReelWatch, reelWatch, snapshotRates } from "./reels";

// The Published list (plan 10 §10.2, M6-09): every post that went out, newest first, with its D7
// numbers, and the same rows as a CSV file. A post younger than three days shows its newest
// snapshot instead (H2, D1, `early`), and a Reel the watch metrics of the snapshot shown.

const d = schema.vPublicationDimensions;
const m = schema.vPublicationMetricsD7;
const yt = schema.youtubeUploads;

export const DEFAULT_PUBLISHED_PAGE_SIZE = 25;
export const MAX_CSV_ROWS = 5000;

export const ListPublishedInput = z.object({
  /** `markets.code`. */
  market: z.string().min(1).max(20).optional(),
  format: z.enum(["CAROUSEL", "REEL"]).optional(),
  /** Inclusive / exclusive, ISO 8601. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(DEFAULT_PUBLISHED_PAGE_SIZE),
});
export type ListPublishedInput = z.input<typeof ListPublishedInput>;

export type PublishedRow = {
  publicationId: string;
  variantId: string;
  ideaId: string;
  marketCode: string;
  format: string;
  hook: string | null;
  hookType: string | null;
  publishedAt: Date;
  permalink: string | null;
  /** The Short on YouTube (G-09), once its upload is PUBLISHED. */
  youtubeUrl: string | null;
  /** The snapshot the numbers are from (`pickShown`); null before the first one. */
  slot: string | null;
  isExactD7: boolean | null;
  /** The numbers are from a snapshot younger than 72 h, not yet the D7 ones. */
  early: boolean;
  reach: number | null;
  saveRate: number | null;
  shareRate: number | null;
  commentRate: number | null;
  engagementRate: number | null;
  /** A Reel: the watch metrics of the snapshot shown; null for a carousel. */
  watch: ReelWatch | null;
};

export type PublishedList = { rows: PublishedRow[]; total: number; page: number; pageSize: number };

async function query(
  ctx: ServiceContext,
  input: z.output<typeof ListPublishedInput>,
  limit: number,
  offset: number,
): Promise<{ rows: PublishedRow[]; total: number }> {
  const where = and(
    ...(input.market ? [eq(d.marketCode, input.market)] : []),
    ...(input.format ? [eq(d.format, input.format)] : []),
    ...(input.from ? [gte(d.publishedAt, new Date(input.from))] : []),
    ...(input.to ? [lt(d.publishedAt, new Date(input.to))] : []),
  );
  const rows = await ctx.db
    .select({
      publicationId: d.publicationId,
      variantId: d.variantId,
      ideaId: d.masterIdeaId,
      marketCode: d.marketCode,
      format: d.format,
      hook: schema.contentVariants.hook,
      hookType: d.hookType,
      publishedAt: d.publishedAt,
      permalink: schema.publications.permalink,
      youtubeUrl: yt.url,
      slot: m.snapshotSlot,
      isExactD7: m.isExactD7,
      reach: m.reach,
      saveRate: m.saveRate,
      shareRate: m.shareRate,
      commentRate: m.commentRate,
      engagementRate: m.engagementRate,
      durationMs: schema.reelRenders.durationMs,
    })
    .from(d)
    .innerJoin(schema.contentVariants, eq(schema.contentVariants.id, d.variantId))
    .innerJoin(schema.publications, eq(schema.publications.id, d.publicationId))
    .leftJoin(m, eq(m.publicationId, d.publicationId))
    .leftJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, schema.publications.contentVariantVersionId),
    )
    .leftJoin(
      schema.reelRenders,
      eq(schema.reelRenders.id, schema.contentVariantVersions.reelRenderId),
    )
    .leftJoin(
      yt,
      and(eq(yt.publicationId, d.publicationId), eq(yt.dryRun, false), eq(yt.status, "PUBLISHED")),
    )
    .where(where)
    .orderBy(desc(d.publishedAt), desc(d.publicationId))
    .limit(limit)
    .offset(offset);
  const [totalRow] = await ctx.db.select({ n: count() }).from(d).where(where);

  // The snapshots of the posts with no D7 numbers yet, and of the Reels for their watch metrics.
  const needed = rows
    .filter((r) => r.slot === null || r.format === "REEL")
    .map((r) => r.publicationId);
  const snapshots =
    needed.length === 0
      ? []
      : await ctx.db
          .select()
          .from(schema.metricSnapshots)
          .where(inArray(schema.metricSnapshots.publicationId, needed));
  const byPub = new Map<string, (typeof snapshots)[number][]>();
  for (const s of snapshots) byPub.set(s.publicationId, [...(byPub.get(s.publicationId) ?? []), s]);

  return {
    rows: rows.map(({ durationMs, ...r }) => {
      const shown = pickShown(byPub.get(r.publicationId) ?? []);
      const watch = r.format === "REEL" ? reelWatch(shown?.videoMetricsJson, durationMs) : null;
      if (r.slot === null && shown)
        return {
          ...r,
          slot: shown.snapshotSlot,
          isExactD7: false,
          early: true,
          reach: shown.reach,
          ...snapshotRates(shown),
          watch,
        };
      return {
        ...r,
        early: false,
        saveRate: num(r.saveRate),
        shareRate: num(r.shareRate),
        commentRate: num(r.commentRate),
        engagementRate: num(r.engagementRate),
        watch,
      };
    }),
    total: Number(totalRow?.n ?? 0),
  };
}

export async function listPublished(
  ctx: ServiceContext,
  raw: ListPublishedInput = {},
): Promise<PublishedList> {
  const input = ListPublishedInput.parse(raw);
  const { rows, total } = await query(
    ctx,
    input,
    input.pageSize,
    (input.page - 1) * input.pageSize,
  );
  return { rows, total, page: input.page, pageSize: input.pageSize };
}

// --- CSV ---------------------------------------------------------------------------------------

const CSV_COLUMNS = [
  "published_at",
  "market",
  "format",
  "hook",
  "hook_type",
  "permalink",
  "youtube_url",
  "d7_slot",
  "is_exact_d7",
  "reach",
  "save_rate",
  "share_rate",
  "comment_rate",
  "engagement_rate",
] as const;

/**
 * One CSV cell. A cell that starts with `=`, `+`, `-`, `@`, a tab or a return is prefixed with an
 * apostrophe, so that a spreadsheet does not run a hook such as `=HYPERLINK(...)` as a formula.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The rows as CSV text (UTF-8, `\r\n` line ends, a header row); rates are fractions, not percents. */
export function publishedToCsv(rows: readonly PublishedRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.publishedAt.toISOString(),
        r.marketCode,
        r.format,
        r.hook,
        r.hookType,
        r.permalink,
        r.youtubeUrl,
        r.slot,
        r.isExactD7,
        r.reach,
        r.saveRate,
        r.shareRate,
        r.commentRate,
        r.engagementRate,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** The filtered list as a CSV file's text, at most `MAX_CSV_ROWS` rows. */
export async function exportPublishedCsv(
  ctx: ServiceContext,
  raw: Omit<ListPublishedInput, "page" | "pageSize"> = {},
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const input = ListPublishedInput.parse(raw);
  const { rows, total } = await query(ctx, input, MAX_CSV_ROWS, 0);
  return { csv: publishedToCsv(rows), rows: rows.length, truncated: total > rows.length };
}

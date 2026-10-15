import { randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import { and, desc, eq, inArray, isNotNull, notExists, sql } from "@rc/db/orm";
import { ForbiddenError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { storageKeys } from "@rc/lib/providers/storage";
import { z } from "zod";
import { audit, type ServiceContext, triggerJob } from "../../core";
import {
  ATTRIBUTION_FIELDS,
  AttributionFileError,
  type AttributionMapping,
  type AttributionRowError,
  type ParsedAttribution,
  parseAttributionCsv,
} from "./parse";

// Leads, sales and refunds (plan 11 §11.7, M6-08): typed in by hand or imported from a CSV of the
// selling stack (J18). Every event names a campaign id (`rc-es-261011-k3f9qa`, made at approval);
// an id that no post has stays in the table and shows in the reconciliation list until someone
// points it at the right campaign. Re-importing a file adds nothing: rows are unique by source and
// reference. No customer personal data is stored (A-10).

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_STORED_ERRORS = 100;
export const ATTRIBUTION_TYPES = ["LEAD", "SALE", "REFUND"] as const;

const parseInput = <S extends z.ZodType>(zod: S, raw: unknown): z.output<S> => {
  const parsed = zod.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};
const actingUserId = (ctx: ServiceContext) => (ctx.actor.type === "USER" ? ctx.actor.userId : null);
const requireEditor = (ctx: ServiceContext) => {
  if (ctx.actor.type === "USER" && ctx.actor.role === "chef") throw new ForbiddenError();
};

const CampaignId = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9._-]+$/u, "Use the campaign id as it is in the link, like rc-es-261011-k3f9qa.");

/** The market part of a campaign id: `rc-es-261011-k3f9qa` → `es`. */
const campaignMarketPart = (campaignId: string): string | null =>
  /^rc-([a-z0-9]{1,8})-\d{6}-[a-z0-9]{6}$/u.exec(campaignId)?.[1] ?? null;
const marketPart = (code: string) =>
  (code.split("-")[0] ?? code).toLowerCase().replace(/[^a-z0-9]/gu, "");

type MarketRow = { id: string; code: string; currency: string };
type CampaignRow = { campaignId: string; marketId: string; offerId: string | null };

async function loadMarkets(ctx: ServiceContext): Promise<MarketRow[]> {
  return ctx.db
    .select({
      id: schema.markets.id,
      code: schema.markets.code,
      currency: schema.markets.currency,
    })
    .from(schema.markets);
}

async function loadCampaigns(
  ctx: ServiceContext,
  ids: string[],
): Promise<Map<string, CampaignRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({
      campaignId: schema.contentVariants.campaignId,
      marketId: schema.contentVariants.marketId,
      offerId: schema.contentVariants.offerId,
    })
    .from(schema.contentVariants)
    .where(inArray(schema.contentVariants.campaignId, ids));
  return new Map(
    rows.flatMap((r) => (r.campaignId ? [[r.campaignId, { ...r, campaignId: r.campaignId }]] : [])),
  );
}

/**
 * The market of an event: the market of its campaign when a post has that id, else the market
 * named in the row, else the one in the id's market part (`rc-es-…` → es-ES). Null = unknown.
 */
function resolveMarket(
  markets: MarketRow[],
  campaign: CampaignRow | undefined,
  named: string | null,
  campaignId: string | null,
): MarketRow | null {
  if (campaign) return markets.find((m) => m.id === campaign.marketId) ?? null;
  if (named) {
    const want = named.trim().toLowerCase();
    return (
      markets.find((m) => m.code.toLowerCase() === want) ??
      markets.find((m) => marketPart(m.code) === want) ??
      null
    );
  }
  const part = campaignId ? campaignMarketPart(campaignId) : null;
  return part ? (markets.find((m) => marketPart(m.code) === part) ?? null) : null;
}

// --- Manual entry --------------------------------------------------------------------------------

export const RecordAttributionInput = z
  .object({
    type: z.enum(ATTRIBUTION_TYPES),
    occurredAt: z.iso.datetime({ offset: true }),
    campaignId: CampaignId.optional(),
    /** Needed when the campaign id is unknown and does not name a market. */
    marketId: z.uuid().optional(),
    quantity: z.number().int().min(1).max(100_000).default(1),
    /** In the market's currency. */
    amount: z.number().min(0).max(9_999_999_999).optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/u, "Use a three-letter code like EUR.")
      .optional(),
    /** The order id; never an e-mail or a name. */
    externalRef: z
      .string()
      .trim()
      .max(200)
      .refine((v) => !v.includes("@"), "Use the order id, not an e-mail.")
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((v, issue) => {
    if (v.type !== "LEAD" && v.amount === undefined) {
      issue.addIssue({
        code: "custom",
        path: ["amount"],
        message: "A sale or a refund needs its amount.",
      });
    }
  });

export async function recordAttributionEvent(
  ctx: ServiceContext,
  raw: z.input<typeof RecordAttributionInput>,
): Promise<{ id: string; campaignKnown: boolean }> {
  requireEditor(ctx);
  const input = parseInput(RecordAttributionInput, raw);
  const markets = await loadMarkets(ctx);
  const campaigns = await loadCampaigns(ctx, input.campaignId ? [input.campaignId] : []);
  const campaign = input.campaignId ? campaigns.get(input.campaignId) : undefined;
  const market =
    (input.marketId && !campaign ? markets.find((m) => m.id === input.marketId) : null) ??
    resolveMarket(markets, campaign, null, input.campaignId ?? null);
  if (!market) {
    throw new ValidationError("Pick the market: the campaign id does not name one.", {
      fieldErrors: { marketId: ["Pick the market."] },
    });
  }
  const id = randomUUID();
  await ctx.db.insert(schema.attributionEvents).values({
    id,
    marketId: market.id,
    type: input.type,
    occurredAt: new Date(input.occurredAt),
    campaignId: input.campaignId ?? null,
    offerId: campaign?.offerId ?? null,
    quantity: input.quantity,
    amount: input.amount === undefined ? null : input.amount.toFixed(2),
    currency: input.amount === undefined ? null : (input.currency ?? market.currency),
    source: "MANUAL",
    // Unique by (source, reference): two hand-typed events without an order id must both stay.
    externalRef: input.externalRef || `manual:${id}`,
    notes: input.notes || null,
    createdBy: actingUserId(ctx),
  });
  await audit(ctx, {
    action: "attribution.recorded",
    entityType: "attribution_event",
    entityId: id,
    marketId: market.id,
    data: { type: input.type, campaignId: input.campaignId ?? null, quantity: input.quantity },
  });
  return { id, campaignKnown: Boolean(campaign) };
}

export const DeleteAttributionInput = z.object({ id: z.uuid() });

/** Removes one event typed or imported by mistake (owners only). */
export async function deleteAttributionEvent(
  ctx: ServiceContext,
  raw: z.input<typeof DeleteAttributionInput>,
): Promise<void> {
  if (ctx.actor.type === "USER" && ctx.actor.role !== "owner") throw new ForbiddenError();
  const { id } = parseInput(DeleteAttributionInput, raw);
  const [row] = await ctx.db
    .delete(schema.attributionEvents)
    .where(eq(schema.attributionEvents.id, id))
    .returning();
  if (!row) throw new NotFoundError("The event is gone already.");
  await audit(ctx, {
    action: "attribution.deleted",
    entityType: "attribution_event",
    entityId: id,
    marketId: row.marketId,
    data: { type: row.type, campaignId: row.campaignId, source: row.source },
  });
}

// --- CSV import (J18) ----------------------------------------------------------------------------

const Mapping = z
  .partialRecord(z.enum(ATTRIBUTION_FIELDS), z.string().trim().min(1).max(100))
  .default({});

export const CreateAttributionImportInput = z.object({
  fileName: z.string().trim().min(1).max(255),
  text: z.string().min(1),
  mapping: Mapping,
});

/** Stores the file and starts J18; the result is in the import list (`listAttributionImports`). */
export async function createAttributionImport(
  ctx: ServiceContext,
  raw: z.input<typeof CreateAttributionImportInput>,
): Promise<{ batchId: string }> {
  requireEditor(ctx);
  const input = parseInput(CreateAttributionImportInput, raw);
  if (!input.fileName.toLowerCase().endsWith(".csv")) {
    throw new ValidationError("Use a .csv file.", { fieldErrors: { file: ["Use a .csv file."] } });
  }
  const bytes = new TextEncoder().encode(input.text);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ValidationError("The file is too big (5 MB at most).", {
      fieldErrors: { file: ["The file is too big (5 MB at most)."] },
    });
  }
  // Read it once here so a file without the needed columns is refused at once, not by the job.
  try {
    parseAttributionCsv(input.text, input.mapping);
  } catch (error) {
    if (error instanceof AttributionFileError) {
      throw new ValidationError(error.message, { fieldErrors: { file: [error.message] } });
    }
    throw error;
  }
  const batchId = randomUUID();
  const fileKey = storageKeys.import(batchId, "csv");
  await ctx.storage.put(fileKey, bytes, { contentType: "text/csv" });
  await audit(ctx, {
    action: "attribution.import_requested",
    entityType: "attribution_import",
    entityId: batchId,
    data: { fileName: input.fileName, bytes: bytes.byteLength },
  });
  await triggerJob(
    ctx,
    "import-attribution-csv",
    { fileKey, batchId, mapping: input.mapping },
    { idempotencyKey: `attribution-import:${batchId}` },
  );
  return { batchId };
}

export const ImportAttributionPayload = z.object({
  fileKey: z.string().min(1),
  batchId: z.uuid(),
  mapping: Mapping,
});

export type AttributionImportReport = {
  batchId: string;
  totalRows: number;
  created: number;
  /** Rows whose reference is in the table already (an earlier import of the same order). */
  duplicates: number;
  /** Rows whose campaign id no post has: imported, and listed for reconciliation. */
  unknownCampaigns: number;
  errorCount: number;
  errors: AttributionRowError[];
};

/**
 * J18: reads the stored file and inserts the events, skipping references already there. A file
 * that cannot be read is a report with one error, not an exception (a retry would not help).
 */
export async function importAttributionCsv(
  ctx: ServiceContext,
  raw: z.input<typeof ImportAttributionPayload>,
): Promise<AttributionImportReport> {
  const input = parseInput(ImportAttributionPayload, raw);
  const report: AttributionImportReport = {
    batchId: input.batchId,
    totalRows: 0,
    created: 0,
    duplicates: 0,
    unknownCampaigns: 0,
    errorCount: 0,
    errors: [],
  };
  const finish = async () => {
    report.errorCount = report.errors.length;
    report.errors = report.errors.slice(0, MAX_STORED_ERRORS);
    await audit(ctx, {
      action: "attribution.imported",
      entityType: "attribution_import",
      entityId: input.batchId,
      data: { ...report },
    });
    return report;
  };

  let parsed: ReturnType<typeof parseAttributionCsv>;
  try {
    const text = new TextDecoder().decode(await ctx.storage.getBytes(input.fileKey));
    parsed = parseAttributionCsv(text, input.mapping);
  } catch (error) {
    if (error instanceof AttributionFileError) {
      report.errors.push({ row: 1, message: error.message });
      return finish();
    }
    throw error;
  }
  report.totalRows = parsed.totalRows;
  report.errors.push(...parsed.errors);

  const markets = await loadMarkets(ctx);
  const campaigns = await loadCampaigns(ctx, [
    ...new Set(parsed.rows.flatMap((r) => (r.campaignId ? [r.campaignId] : []))),
  ]);
  const values: (typeof schema.attributionEvents.$inferInsert)[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const campaign = row.campaignId ? campaigns.get(row.campaignId) : undefined;
    const market = resolveMarket(markets, campaign, row.market, row.campaignId);
    if (!market) {
      report.errors.push({
        row: row.row,
        field: "market",
        message: "Unknown market: add a market column (es-ES, en) or a campaign id from a post.",
      });
      continue;
    }
    if (seen.has(row.externalRef)) {
      report.duplicates += 1;
      continue;
    }
    seen.add(row.externalRef);
    if (row.campaignId && !campaign) report.unknownCampaigns += 1;
    values.push(toInsert(row, market, campaign, input.batchId, ctx));
  }
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    const inserted = await ctx.db
      .insert(schema.attributionEvents)
      .values(chunk)
      .onConflictDoNothing({
        target: [schema.attributionEvents.source, schema.attributionEvents.externalRef],
      })
      .returning({ id: schema.attributionEvents.id });
    report.created += inserted.length;
    report.duplicates += chunk.length - inserted.length;
  }
  return finish();
}

function toInsert(
  row: ParsedAttribution,
  market: MarketRow,
  campaign: CampaignRow | undefined,
  batchId: string,
  ctx: ServiceContext,
): typeof schema.attributionEvents.$inferInsert {
  return {
    marketId: market.id,
    type: row.type,
    occurredAt: new Date(row.occurredAt),
    campaignId: row.campaignId,
    offerId: campaign?.offerId ?? null,
    quantity: row.quantity,
    amount: row.amount,
    currency: row.amount === null ? null : (row.currency ?? market.currency),
    source: "CSV_IMPORT",
    externalRef: row.externalRef,
    utm: row.utm,
    importBatchId: batchId,
    createdBy: actingUserId(ctx),
  };
}

export type AttributionImportEntry = {
  batchId: string;
  fileName: string | null;
  requestedAt: Date;
  /** Null while J18 has not finished. */
  report: AttributionImportReport | null;
};

/** The latest imports, newest first, with their reports once J18 is done. */
export async function listAttributionImports(
  ctx: ServiceContext,
  limit = 5,
): Promise<AttributionImportEntry[]> {
  const requested = await ctx.db
    .select({
      batchId: schema.auditEvents.entityId,
      occurredAt: schema.auditEvents.occurredAt,
      data: schema.auditEvents.data,
    })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, "attribution.import_requested"))
    .orderBy(desc(schema.auditEvents.occurredAt))
    .limit(limit);
  const ids = requested.flatMap((r) => (r.batchId ? [r.batchId] : []));
  const done =
    ids.length === 0
      ? []
      : await ctx.db
          .select({ batchId: schema.auditEvents.entityId, data: schema.auditEvents.data })
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.action, "attribution.imported"),
              inArray(schema.auditEvents.entityId, ids),
            ),
          );
  const reports = new Map(done.map((d) => [d.batchId, d.data as AttributionImportReport]));
  return requested.map((r) => ({
    batchId: r.batchId ?? "",
    fileName: typeof r.data.fileName === "string" ? r.data.fileName : null,
    requestedAt: r.occurredAt,
    report: reports.get(r.batchId) ?? null,
  }));
}

// --- Reconciliation ------------------------------------------------------------------------------

export type UnknownCampaign = {
  campaignId: string;
  marketCode: string;
  events: number;
  leads: number;
  sales: number;
  firstAt: Date;
  lastAt: Date;
};

/** Campaign ids of events that no post has (a typo, a link from another tool), most events first. */
export async function listUnknownCampaigns(ctx: ServiceContext): Promise<UnknownCampaign[]> {
  const a = schema.attributionEvents;
  const rows = await ctx.db
    .select({
      campaignId: a.campaignId,
      marketCode: schema.markets.code,
      events: sql<number>`count(*)::int`,
      leads: sql<number>`coalesce(sum(${a.quantity}) filter (where ${a.type} = 'LEAD'), 0)::int`,
      sales: sql<number>`coalesce(sum(${a.quantity}) filter (where ${a.type} = 'SALE'), 0)::int`,
      firstAt: sql<Date>`min(${a.occurredAt})`,
      lastAt: sql<Date>`max(${a.occurredAt})`,
    })
    .from(a)
    .innerJoin(schema.markets, eq(schema.markets.id, a.marketId))
    .where(
      and(
        isNotNull(a.campaignId),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(schema.contentVariants)
            .where(eq(schema.contentVariants.campaignId, a.campaignId)),
        ),
      ),
    )
    .groupBy(a.campaignId, schema.markets.code)
    .orderBy(sql`count(*) desc`, a.campaignId);
  return rows.map((r) => ({
    campaignId: r.campaignId ?? "",
    marketCode: r.marketCode,
    events: Number(r.events),
    leads: Number(r.leads),
    sales: Number(r.sales),
    firstAt: new Date(r.firstAt),
    lastAt: new Date(r.lastAt),
  }));
}

export const ReassignCampaignInput = z.object({ from: CampaignId, to: CampaignId });

/**
 * Points the events of an unknown campaign id at a campaign a post has (a typo in the link, a
 * renamed flow). The events take that post's market and offer.
 */
export async function reassignCampaign(
  ctx: ServiceContext,
  raw: z.input<typeof ReassignCampaignInput>,
): Promise<{ moved: number }> {
  requireEditor(ctx);
  const { from, to } = parseInput(ReassignCampaignInput, raw);
  const target = (await loadCampaigns(ctx, [to])).get(to);
  if (!target) {
    throw new ValidationError("No post has this campaign id.", {
      fieldErrors: { to: ["No post has this campaign id."] },
    });
  }
  const moved = await ctx.db
    .update(schema.attributionEvents)
    .set({ campaignId: to, marketId: target.marketId, offerId: target.offerId })
    .where(eq(schema.attributionEvents.campaignId, from))
    .returning({ id: schema.attributionEvents.id });
  await audit(ctx, {
    action: "attribution.reassigned",
    entityType: "campaign",
    marketId: target.marketId,
    data: { from, to, events: moved.length },
  });
  return { moved: moved.length };
}

// --- Listing -------------------------------------------------------------------------------------

export type AttributionEventRow = {
  id: string;
  type: (typeof ATTRIBUTION_TYPES)[number];
  occurredAt: Date;
  campaignId: string | null;
  marketCode: string;
  quantity: number;
  amount: number | null;
  currency: string | null;
  source: string;
};

/** The latest events, newest first (the Commercial tab shows them under the form). */
export async function listAttributionEvents(
  ctx: ServiceContext,
  options: { limit?: number; marketId?: string } = {},
): Promise<AttributionEventRow[]> {
  const a = schema.attributionEvents;
  const rows = await ctx.db
    .select({
      id: a.id,
      type: a.type,
      occurredAt: a.occurredAt,
      campaignId: a.campaignId,
      marketCode: schema.markets.code,
      quantity: a.quantity,
      amount: a.amount,
      currency: a.currency,
      source: a.source,
    })
    .from(a)
    .innerJoin(schema.markets, eq(schema.markets.id, a.marketId))
    .where(options.marketId ? eq(a.marketId, options.marketId) : undefined)
    .orderBy(desc(a.occurredAt), desc(a.createdAt))
    .limit(options.limit ?? 10);
  return rows.map((r) => ({ ...r, amount: r.amount === null ? null : Number(r.amount) }));
}

/** Campaign ids that posts have, newest first (the suggestions of the reconciliation form). */
export async function listKnownCampaignIds(ctx: ServiceContext, limit = 200): Promise<string[]> {
  const rows = await ctx.db
    .select({ campaignId: schema.contentVariants.campaignId })
    .from(schema.contentVariants)
    .where(isNotNull(schema.contentVariants.campaignId))
    .orderBy(desc(schema.contentVariants.updatedAt))
    .limit(limit);
  return rows.flatMap((r) => (r.campaignId ? [r.campaignId] : []));
}

export type { AttributionMapping };

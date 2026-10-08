import { schema } from "@rc/db";
import { and, asc, desc, eq, isNull, or } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { z } from "zod";
import { audit, type ServiceContext, withTransaction } from "../../core";

// Voice examples (plan 04 §4.3 `voice_examples`, 07 §7.11, M2-17): what the writer learns the
// voice of a market from. An EXEMPLAR is an approved text, an EDIT_PAIR a reviewer's "before →
// after" with its reason, a RULE a standing instruction. Seed rows come from Sergey's edits and
// are managed here; REVIEW_EVENT rows arrive with the review screen (M4) and are only switched
// on and off.

type Row = typeof schema.voiceExamples.$inferSelect;

export const VOICE_KINDS = ["EXEMPLAR", "EDIT_PAIR", "RULE"] as const;
const MAX_TEXT = 2000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Language of the text, ISO 639-1; absent = any language. */
const Language = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/, "Use a two-letter language code, e.g. es.")
  .nullish()
  .transform((v) => v ?? null);

const Fields = z.object({
  /** Null = every market. */
  marketId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  kind: z.enum(VOICE_KINDS),
  beforeText: optionalText(MAX_TEXT),
  afterText: optionalText(MAX_TEXT),
  /** The reason code or comment of an edit pair; the text of a rule. */
  note: optionalText(500),
  language: Language,
});

const fail = (field: string, message: string): never => {
  throw new ValidationError(message, { fieldErrors: { [field]: [message] } });
};

/** What each kind must carry (and must not). */
function checkShape(value: z.output<typeof Fields>): void {
  if (value.kind === "EXEMPLAR") {
    if (!value.afterText) fail("afterText", "An example needs its text.");
    if (value.beforeText) fail("beforeText", "An example has no “before” text.");
  } else if (value.kind === "EDIT_PAIR") {
    if (!value.beforeText) fail("beforeText", "An edit needs the text before.");
    if (!value.afterText) fail("afterText", "An edit needs the text after.");
    if (value.beforeText === value.afterText) fail("afterText", "The two texts are the same.");
  } else {
    if (!value.note) fail("note", "A rule needs its text in the note.");
    if (value.beforeText || value.afterText) {
      fail("note", "A rule is the note only: leave the texts empty.");
    }
  }
}

const parse = (raw: unknown) => {
  const parsed = Fields.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  checkShape(parsed.data);
  return parsed.data;
};

async function assertMarket(ctx: ServiceContext, marketId: string | null): Promise<void> {
  if (!marketId) return;
  const [market] = await ctx.db
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId));
  if (!market) fail("marketId", "This market does not exist.");
}

const isEditor = (ctx: ServiceContext) =>
  ctx.actor.type !== "USER" || ctx.actor.role === "owner" || ctx.actor.role === "editor";

/** Adds a seed example (owner, editor). Review-event rows are made by the review screen, not here. */
export async function createVoiceExample(
  ctx: ServiceContext,
  raw: z.input<typeof Fields>,
): Promise<Row> {
  if (!isEditor(ctx)) throw new ForbiddenError("Only owners and editors can add voice examples.");
  const value = parse(raw);
  await assertMarket(ctx, value.marketId);
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(schema.voiceExamples)
      .values({ ...value, source: "SEED" })
      .returning();
    if (!row) throw new Error("Insert returned no row.");
    await audit(tx, {
      action: "voice_example.created",
      entityType: "voice_example",
      entityId: row.id,
      ...(row.marketId ? { marketId: row.marketId } : {}),
      data: { kind: row.kind },
    });
    return row;
  });
}

export const UpdateVoiceExampleInput = z.object({
  id: z.uuid(),
  patch: Fields.partial().refine((p) => Object.keys(p).length > 0, {
    message: "Nothing to change.",
  }),
});

/** Edits a seed example; the result must still be valid for its kind. A review-event row is read-only. */
export async function updateVoiceExample(
  ctx: ServiceContext,
  raw: z.input<typeof UpdateVoiceExampleInput>,
): Promise<Row> {
  if (!isEditor(ctx)) throw new ForbiddenError("Only owners and editors can edit voice examples.");
  const input = UpdateVoiceExampleInput.safeParse(raw);
  if (!input.success) throw ValidationError.fromZod(input.error);
  const { id, patch } = input.data;
  const [current] = await ctx.db
    .select()
    .from(schema.voiceExamples)
    .where(eq(schema.voiceExamples.id, id));
  if (!current) throw new NotFoundError("Voice example not found.", { details: { id } });
  if (current.source !== "SEED") {
    throw new InvalidStateError("An example made by a review can only be switched on or off.");
  }
  const merged = parse({
    marketId: current.marketId,
    kind: current.kind,
    beforeText: current.beforeText,
    afterText: current.afterText,
    note: current.note,
    language: current.language,
    ...patch,
  });
  await assertMarket(ctx, merged.marketId);
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(schema.voiceExamples)
      .set(merged)
      .where(eq(schema.voiceExamples.id, id))
      .returning();
    if (!row) throw new NotFoundError("Voice example not found.", { details: { id } });
    await audit(tx, {
      action: "voice_example.updated",
      entityType: "voice_example",
      entityId: id,
      data: { fields: Object.keys(patch) },
    });
    return row;
  });
}

/** Switches an example on or off (any source); an inactive one is never shown to the writer. */
export async function setVoiceExampleActive(
  ctx: ServiceContext,
  input: { id: string; active: boolean },
): Promise<Row> {
  if (!isEditor(ctx))
    throw new ForbiddenError("Only owners and editors can change voice examples.");
  const [row] = await ctx.db
    .update(schema.voiceExamples)
    .set({ isActive: input.active })
    .where(eq(schema.voiceExamples.id, input.id))
    .returning();
  if (!row) throw new NotFoundError("Voice example not found.", { details: { id: input.id } });
  await audit(ctx, {
    action: input.active ? "voice_example.activated" : "voice_example.deactivated",
    entityType: "voice_example",
    entityId: row.id,
  });
  return row;
}

/** Deletes a seed example; one made by a review is kept (switch it off instead). */
export async function deleteVoiceExample(ctx: ServiceContext, id: string): Promise<void> {
  if (!isEditor(ctx))
    throw new ForbiddenError("Only owners and editors can delete voice examples.");
  const [row] = await ctx.db
    .select()
    .from(schema.voiceExamples)
    .where(eq(schema.voiceExamples.id, id));
  if (!row) throw new NotFoundError("Voice example not found.", { details: { id } });
  if (row.source !== "SEED") {
    throw new InvalidStateError("An example made by a review cannot be deleted. Switch it off.");
  }
  await withTransaction(ctx, async (tx) => {
    await tx.db.delete(schema.voiceExamples).where(eq(schema.voiceExamples.id, id));
    await audit(tx, {
      action: "voice_example.deleted",
      entityType: "voice_example",
      entityId: id,
      data: { kind: row.kind },
    });
  });
}

export const ListVoiceExamplesInput = z.object({
  /** Examples of this market and the ones for every market; absent = all. */
  marketId: z.uuid().optional(),
  kind: z.enum(VOICE_KINDS).optional(),
  includeInactive: z.boolean().default(false),
});

export async function listVoiceExamples(
  ctx: ServiceContext,
  raw: z.input<typeof ListVoiceExamplesInput> = {},
): Promise<Row[]> {
  const input = ListVoiceExamplesInput.parse(raw);
  return ctx.db
    .select()
    .from(schema.voiceExamples)
    .where(
      and(
        input.marketId
          ? or(
              eq(schema.voiceExamples.marketId, input.marketId),
              isNull(schema.voiceExamples.marketId),
            )
          : undefined,
        input.kind ? eq(schema.voiceExamples.kind, input.kind) : undefined,
        input.includeInactive ? undefined : eq(schema.voiceExamples.isActive, true),
      ),
    )
    .orderBy(
      asc(schema.voiceExamples.kind),
      desc(schema.voiceExamples.createdAt),
      asc(schema.voiceExamples.id),
    );
}

// --- seed import ---------------------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 500;

const ImportRow = z.object({
  /** Market code (`es-ES`, `en`); empty = every market. */
  market: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null),
  kind: z.enum(VOICE_KINDS),
  before: optionalText(MAX_TEXT),
  after: optionalText(MAX_TEXT),
  note: optionalText(500),
  language: Language,
});

export type ImportResult = { created: number; skipped: number };

/**
 * Imports Sergey's edits (and the rules and examples around them) as seed rows. Every row is
 * checked first and one bad row refuses the whole file, with the row numbers; a row that is
 * already there (same market, kind and texts) is skipped, so importing a file twice changes nothing.
 */
export async function importVoiceExamples(
  ctx: ServiceContext,
  rows: readonly unknown[],
): Promise<ImportResult> {
  if (!isEditor(ctx))
    throw new ForbiddenError("Only owners and editors can import voice examples.");
  if (rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(`Give between 1 and ${MAX_IMPORT_ROWS} rows.`);
  }
  const markets = new Map(
    (
      await ctx.db.select({ id: schema.markets.id, code: schema.markets.code }).from(schema.markets)
    ).map((m) => [m.code, m.id]),
  );
  const fieldErrors: Record<string, string[]> = {};
  const prepared: z.output<typeof Fields>[] = [];
  rows.forEach((raw, i) => {
    const key = `row ${i + 1}`;
    const parsed = ImportRow.safeParse(raw);
    if (!parsed.success) {
      fieldErrors[key] = parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      return;
    }
    const { market, before, after, ...rest } = parsed.data;
    if (market && !markets.has(market)) {
      fieldErrors[key] = [`market: "${market}" is not a market.`];
      return;
    }
    const value = Fields.safeParse({
      ...rest,
      marketId: market ? markets.get(market) : null,
      beforeText: before,
      afterText: after,
    });
    try {
      if (!value.success) throw ValidationError.fromZod(value.error);
      checkShape(value.data);
      prepared.push(value.data);
    } catch (error) {
      fieldErrors[key] =
        error instanceof ValidationError
          ? Object.entries(error.fieldErrors ?? {}).flatMap(([field, messages]) =>
              messages.map((m) => `${field}: ${m}`),
            )
          : [String(error)];
    }
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError("Some rows are not valid; nothing was imported.", { fieldErrors });
  }

  const existing = await ctx.db.select().from(schema.voiceExamples);
  const keyOf = (v: {
    marketId: string | null;
    kind: string;
    beforeText: string | null;
    afterText: string | null;
    note: string | null;
  }) => JSON.stringify([v.marketId, v.kind, v.beforeText, v.afterText, v.note]);
  const seen = new Set(existing.map(keyOf));
  const fresh = prepared.filter((v) => {
    const key = keyOf(v);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length > 0) {
    await withTransaction(ctx, async (tx) => {
      await tx.db
        .insert(schema.voiceExamples)
        .values(fresh.map((v) => ({ ...v, source: "SEED" as const })));
      await audit(tx, {
        action: "voice_examples.imported",
        entityType: "voice_example",
        data: { created: fresh.length, skipped: prepared.length - fresh.length },
      });
    });
  }
  return { created: fresh.length, skipped: prepared.length - fresh.length };
}

/** A minimal CSV reader (quotes, doubled quotes, commas and line breaks in quoted cells). */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) records.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) records.push(row);
  const [header, ...body] = records;
  if (!header) return [];
  return body.map((cells) =>
    Object.fromEntries(header.map((name, i) => [name.trim(), cells[i] ?? ""])),
  );
}

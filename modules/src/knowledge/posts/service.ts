import { createHash, randomUUID } from "node:crypto";
import { schema } from "@rc/db";
import type { PostAnnotations, PostMetrics, RightsPolicy } from "@rc/db/json";
import { and, count, desc, eq, ilike, inArray, or, sql } from "@rc/db/orm";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { storageKeys } from "@rc/lib/providers/storage";
import { z } from "zod";
import { audit, type ServiceContext, transition, triggerJob, withTransaction } from "../../core";
import { canUseAsExemplar, getRightsDefault } from "../rights";
import { requestPostAnnotations } from "./annotate";
import { type ParsedPost, PostsFileError, parsePostsFile, type RowError } from "./parse";

// Historical posts (plan 05, 07 §7.2.5, 06 J16, M1-22): the file is stored as a source of type
// INSTAGRAM_POST, J16 reads it and upserts the posts on (platform, external id); the person
// annotates and marks exemplars afterwards. Annotation suggestions by the model are M1-23.

const PLATFORM = "instagram";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_STORED_ERRORS = 200;

const parseInput = <S extends z.ZodType>(zod: S, raw: unknown): z.output<S> => {
  const parsed = zod.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
};

const AccountHandle = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/u, "").toLowerCase())
  .pipe(
    z.string().regex(/^[a-z0-9._]{1,30}$/u, "Use the Instagram handle, like regchef_official."),
  );

export const CreatePostsImportInput = z.object({
  fileName: z.string().trim().min(1).max(255),
  text: z.string().min(1),
  accountHandle: AccountHandle,
  language: z
    .string()
    .regex(/^[a-z]{2}$/u, "Use an ISO 639-1 code like 'ru'.")
    .default("ru"),
  /**
   * The owner confirms that these are the posts of their own account and that the model may read
   * the captions (`aiProcessing = ALLOWED`). Needed for annotation suggestions.
   */
  allowAiProcessing: z.boolean().default(false),
  /** After the import, ask the model to suggest annotations for the posts that have none (J17). */
  suggestAnnotations: z.boolean().default(false),
});

/** What the import left on the source row (`metadata_json.import`). */
export type ImportReport = {
  totalRows: number;
  created: number;
  updated: number;
  errorCount: number;
  errors: RowError[];
};

export type PostsImportOutcome =
  | { status: "SKIPPED"; reason: "ALREADY_DONE" | "ARCHIVED" }
  | ({ status: "READY" } & ImportReport)
  | { status: "FAILED"; code: string };

const actingUserId = (ctx: ServiceContext) => (ctx.actor.type === "USER" ? ctx.actor.userId : null);

async function loadBrandId(ctx: ServiceContext): Promise<string> {
  const [brand] = await ctx.db.select({ id: schema.brands.id }).from(schema.brands).limit(1);
  if (!brand) throw new NotFoundError("Brand is not set up.");
  return brand.id;
}

/**
 * Stores the file, registers it as a source and starts J16. The rows are checked by the job, so a
 * big file does not hold the request; the result is on the source (see `listPostImports`).
 */
export async function createPostsImport(
  ctx: ServiceContext,
  raw: z.input<typeof CreatePostsImportInput>,
): Promise<{ sourceAssetId: string }> {
  const input = parseInput(CreatePostsImportInput, raw);
  if (input.allowAiProcessing && ctx.actor.type === "USER" && ctx.actor.role !== "owner") {
    throw new ForbiddenError("Only the owner can allow AI processing of a source.");
  }
  if (input.suggestAnnotations && !input.allowAiProcessing) {
    throw new ValidationError("Allow AI processing to get annotation suggestions.", {
      fieldErrors: { suggestAnnotations: ["Allow AI processing first."] },
    });
  }
  const name = input.fileName.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".json")) {
    throw new ValidationError("Use a .csv or .json file.", {
      fieldErrors: { file: ["Use a .csv or .json file."] },
    });
  }
  const bytes = new TextEncoder().encode(input.text);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ValidationError("The file is too big (20 MB at most).", {
      fieldErrors: { file: ["The file is too big (20 MB at most)."] },
    });
  }
  const id = randomUUID();
  const fileKey = storageKeys.source(id, input.fileName);
  const brandId = await loadBrandId(ctx);
  const {
    confirmedBy: _by,
    confirmedAt: _at,
    ...defaults
  } = await getRightsDefault(ctx, "INSTAGRAM_POST");
  const rights: RightsPolicy = input.allowAiProcessing
    ? {
        ...defaults,
        aiProcessing: "ALLOWED",
        ...(ctx.actor.type === "USER"
          ? { confirmedBy: ctx.actor.userId, confirmedAt: ctx.clock.now().toISOString() }
          : {}),
      }
    : defaults;
  await ctx.storage.put(fileKey, bytes, {
    contentType: name.endsWith(".json") ? "application/json" : "text/csv",
  });
  await ctx.db.insert(schema.sourceAssets).values({
    id,
    brandId,
    type: "INSTAGRAM_POST",
    title: input.fileName,
    fileKey,
    originalFilename: input.fileName,
    mimeType: name.endsWith(".json") ? "application/json" : "text/csv",
    fileSizeBytes: bytes.byteLength,
    originalLanguage: input.language,
    rights,
    metadataJson: {
      accountHandle: input.accountHandle,
      suggestAnnotations: input.suggestAnnotations,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    createdBy: actingUserId(ctx),
  });
  await transition(ctx, {
    table: schema.sourceAssets,
    statusKey: "processingStatus",
    id,
    from: ["PENDING_UPLOAD"],
    to: "QUEUED",
    set: { processingAttempt: 1 },
    audit: {
      action: "posts.import_started",
      entityType: "source_asset",
      data: {
        fileName: input.fileName,
        accountHandle: input.accountHandle,
        aiProcessing: rights.aiProcessing,
      },
    },
  });
  await triggerJob(
    ctx,
    "import-historical-posts",
    { sourceAssetId: id },
    {
      idempotencyKey: `import-posts:${id}`,
    },
  );
  return { sourceAssetId: id };
}

type CodeKind = "category" | "angle" | "hook_type" | "cta_type";
const KIND_OF: Record<string, CodeKind> = {
  category: "category",
  angle: "angle",
  hookType: "hook_type",
  ctaType: "cta_type",
};
const COLUMN_OF: Record<string, string> = {
  category: "category",
  angle: "angle",
  hookType: "hook_type",
  ctaType: "cta_type",
};

/** The active codes of each taxonomy kind used by annotations. */
async function loadCodes(ctx: ServiceContext): Promise<Map<CodeKind, Set<string>>> {
  const rows = await ctx.db
    .select({ kind: schema.taxonomyTerms.kind, code: schema.taxonomyTerms.code })
    .from(schema.taxonomyTerms)
    .where(
      and(
        inArray(schema.taxonomyTerms.kind, ["category", "angle", "hook_type", "cta_type"]),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    );
  const codes = new Map<CodeKind, Set<string>>();
  for (const row of rows) {
    const set = codes.get(row.kind as CodeKind) ?? new Set<string>();
    set.add(row.code);
    codes.set(row.kind as CodeKind, set);
  }
  return codes;
}

/**
 * J16 `import-historical-posts`: reads the stored file, reports the bad rows, and upserts the good
 * ones. A re-import updates caption, link, date, format and the metrics it carries; annotations
 * and the exemplar flag change only where the file has a value, and a row annotated in the file
 * counts as confirmed by a person. Safe to run again.
 */
export async function importHistoricalPosts(
  ctx: ServiceContext,
  input: { sourceAssetId: string },
): Promise<PostsImportOutcome> {
  const [source] = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.id, input.sourceAssetId));
  if (!source) throw new NotFoundError("Source not found.", { details: input });
  if (source.type !== "INSTAGRAM_POST") {
    throw new InvalidStateError("This source is not a posts import.");
  }
  if (source.archivedAt) return { status: "SKIPPED", reason: "ARCHIVED" };
  if (source.processingStatus === "READY" || source.processingStatus === "FAILED") {
    return { status: "SKIPPED", reason: "ALREADY_DONE" };
  }
  const move = (to: "PROCESSING" | "READY" | "FAILED", set: object, action: string, data = {}) =>
    transition(ctx, {
      table: schema.sourceAssets,
      statusKey: "processingStatus",
      id: source.id,
      from: ["QUEUED", "PROCESSING"],
      to,
      set,
      audit: { action, entityType: "source_asset", data },
    });
  const fail = async (code: string, message: string) => {
    await move("FAILED", { processingError: { code, message } }, "posts.import_failed", { code });
    return { status: "FAILED", code } as const;
  };

  await move("PROCESSING", { processingError: null }, "posts.import_processing");
  if (!source.fileKey) return fail("FILE_MISSING", "The import has no file.");
  const text = new TextDecoder("utf-8").decode(await ctx.storage.getBytes(source.fileKey));
  let parsed: ReturnType<typeof parsePostsFile>;
  try {
    parsed = parsePostsFile(source.originalFilename ?? "", text);
  } catch (error) {
    if (error instanceof PostsFileError) return fail(error.code, error.message);
    throw error;
  }

  const meta = source.metadataJson as { accountHandle?: string };
  const accountHandle = meta.accountHandle ?? "";
  const errors: RowError[] = [...parsed.errors];

  // Annotation codes must exist in the taxonomy; a bad code rejects that row, not the file.
  const codes = await loadCodes(ctx);
  const rows: ParsedPost[] = [];
  for (const row of parsed.rows) {
    const bad = Object.entries(KIND_OF).find(([key, kind]) => {
      const value = row.annotations[key as keyof ParsedPost["annotations"]];
      return value !== undefined && !codes.get(kind)?.has(value);
    });
    if (bad) {
      const value = row.annotations[bad[0] as keyof ParsedPost["annotations"]];
      errors.push({
        row: row.row,
        externalId: row.externalId,
        field: COLUMN_OF[bad[0]] ?? bad[0],
        message: `"${value}" is not a ${COLUMN_OF[bad[0]]?.replace("_", " ")} code in the taxonomy.`,
      });
    } else rows.push(row);
  }
  errors.sort((a, b) => a.row - b.row);

  const now = ctx.clock.now().toISOString();
  let created = 0;
  let updated = 0;
  await withTransaction(ctx, async (tx) => {
    const existing = new Map(
      (rows.length
        ? await tx.db
            .select()
            .from(schema.historicalPosts)
            .where(
              and(
                eq(schema.historicalPosts.platform, PLATFORM),
                inArray(
                  schema.historicalPosts.externalId,
                  rows.map((r) => r.externalId),
                ),
              ),
            )
        : []
      ).map((p) => [p.externalId, p]),
    );
    const fresh: (typeof schema.historicalPosts.$inferInsert)[] = [];
    for (const row of rows) {
      const hasAnnotations = Object.keys(row.annotations).length > 0;
      const metrics: PostMetrics = {
        ...row.metrics,
        ...(Object.keys(row.metrics).length ? { collectedAt: now } : {}),
      };
      const old = existing.get(row.externalId);
      if (!old) {
        fresh.push({
          brandId: source.brandId,
          sourceAssetId: source.id,
          platform: PLATFORM,
          accountHandle,
          externalId: row.externalId,
          permalink: row.permalink,
          postedAt: new Date(row.postedAt),
          format: row.format,
          caption: row.caption,
          language: source.originalLanguage,
          metrics,
          annotations: row.annotations,
          annotationStatus: hasAnnotations ? "HUMAN_CONFIRMED" : "NONE",
          isExemplar: row.isExemplar ?? false,
        });
        continue;
      }
      await tx.db
        .update(schema.historicalPosts)
        .set({
          sourceAssetId: source.id,
          permalink: row.permalink ?? old.permalink,
          postedAt: new Date(row.postedAt),
          format: row.format ?? old.format,
          caption: row.caption,
          metrics: { ...old.metrics, ...metrics },
          ...(hasAnnotations
            ? {
                annotations: { ...old.annotations, ...row.annotations },
                annotationStatus: "HUMAN_CONFIRMED" as const,
              }
            : {}),
          ...(row.isExemplar === null ? {} : { isExemplar: row.isExemplar }),
        })
        .where(eq(schema.historicalPosts.id, old.id));
      updated++;
    }
    for (let i = 0; i < fresh.length; i += 200) {
      await tx.db.insert(schema.historicalPosts).values(fresh.slice(i, i + 200));
    }
    created = fresh.length;
  });

  const report: ImportReport = {
    totalRows: parsed.totalRows,
    created,
    updated,
    errorCount: errors.length,
    errors: errors.slice(0, MAX_STORED_ERRORS),
  };
  await move(
    "READY",
    { metadataJson: { ...source.metadataJson, import: report }, processingError: null },
    "posts.imported",
    { totalRows: report.totalRows, created, updated, errors: errors.length },
  );
  if (
    (source.metadataJson as { suggestAnnotations?: boolean }).suggestAnnotations &&
    created + updated > 0
  ) {
    try {
      const unannotated = await ctx.db
        .select({ id: schema.historicalPosts.id })
        .from(schema.historicalPosts)
        .where(
          and(
            eq(schema.historicalPosts.sourceAssetId, source.id),
            eq(schema.historicalPosts.annotationStatus, "NONE"),
          ),
        )
        .limit(200);
      if (unannotated.length > 0) {
        await requestPostAnnotations(ctx, { postIds: unannotated.map((p) => p.id) });
      }
    } catch (error) {
      // The posts are in; the person can ask for suggestions from the screen.
      ctx.logger.warn({ err: error }, "could not queue annotation suggestions after the import");
    }
  }
  return { status: "READY", ...report };
}

// --- reading ---------------------------------------------------------------------------------

export const ListPostsInput = z.object({
  q: z.string().trim().max(200).optional(),
  exemplar: z.boolean().optional(),
  annotation: z.enum(["NONE", "AI_SUGGESTED", "HUMAN_CONFIRMED"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type PostRow = {
  id: string;
  externalId: string;
  accountHandle: string;
  permalink: string | null;
  postedAt: Date | null;
  format: "CAROUSEL" | "REEL" | "SINGLE_IMAGE" | null;
  caption: string;
  metrics: PostMetrics;
  /** likes + comments + saves + shares, when at least one is known. */
  interactions: number | null;
  annotations: PostAnnotations;
  annotationStatus: "NONE" | "AI_SUGGESTED" | "HUMAN_CONFIRMED";
  isExemplar: boolean;
};

export type PostList = { rows: PostRow[]; total: number; page: number; pageSize: number };

export const interactionsOf = (m: PostMetrics): number | null => {
  const parts = [m.likes, m.comments, m.saves, m.shares].filter(
    (v): v is number => v !== undefined,
  );
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
};

const toRow = (p: typeof schema.historicalPosts.$inferSelect): PostRow => ({
  id: p.id,
  externalId: p.externalId,
  accountHandle: p.accountHandle,
  permalink: p.permalink,
  postedAt: p.postedAt,
  format: p.format,
  caption: p.caption ?? "",
  metrics: p.metrics,
  interactions: interactionsOf(p.metrics),
  annotations: p.annotations,
  annotationStatus: p.annotationStatus,
  isExemplar: p.isExemplar,
});

export async function listHistoricalPosts(
  ctx: ServiceContext,
  raw: z.input<typeof ListPostsInput> = {},
): Promise<PostList> {
  const input = parseInput(ListPostsInput, raw);
  const like = input.q ? `%${input.q.replace(/[%_\\]/gu, "\\$&")}%` : null;
  const where = and(
    eq(schema.historicalPosts.platform, PLATFORM),
    like
      ? or(
          ilike(schema.historicalPosts.caption, like),
          ilike(schema.historicalPosts.externalId, like),
        )
      : undefined,
    input.exemplar === undefined
      ? undefined
      : eq(schema.historicalPosts.isExemplar, input.exemplar),
    input.annotation ? eq(schema.historicalPosts.annotationStatus, input.annotation) : undefined,
  );
  const [totalRow] = await ctx.db.select({ n: count() }).from(schema.historicalPosts).where(where);
  const rows = await ctx.db
    .select()
    .from(schema.historicalPosts)
    .where(where)
    .orderBy(
      sql`${schema.historicalPosts.postedAt} desc nulls last`,
      desc(schema.historicalPosts.id),
    )
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  return {
    total: totalRow?.n ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    rows: rows.map(toRow),
  };
}

export type PostImportRow = {
  id: string;
  fileName: string;
  createdAt: Date;
  status: string;
  error: { code: string; message: string } | null;
  report: ImportReport | null;
};

/** The latest imports with what each one did. */
export async function listPostImports(ctx: ServiceContext, limit = 5): Promise<PostImportRow[]> {
  const rows = await ctx.db
    .select()
    .from(schema.sourceAssets)
    .where(eq(schema.sourceAssets.type, "INSTAGRAM_POST"))
    .orderBy(desc(schema.sourceAssets.createdAt))
    .limit(limit);
  return rows.map((s) => ({
    id: s.id,
    fileName: s.originalFilename ?? s.title,
    createdAt: s.createdAt,
    status: s.processingStatus,
    error: s.processingError
      ? { code: s.processingError.code, message: s.processingError.message }
      : null,
    report: (s.metadataJson as { import?: ImportReport }).import ?? null,
  }));
}

// --- annotating ------------------------------------------------------------------------------

const Code = z.string().trim().min(1).max(64);
export const UpdatePostInput = z.object({
  id: z.uuid(),
  /** A code sets the field, null clears it; a missing key leaves it. */
  annotations: z
    .object({
      category: Code.nullable(),
      angle: Code.nullable(),
      hookType: Code.nullable(),
      ctaType: Code.nullable(),
      productCode: Code.nullable(),
      visualPattern: z.string().trim().min(1).max(100).nullable(),
    })
    .partial()
    .strict()
    .optional(),
  isExemplar: z.boolean().optional(),
  /** Accept the suggested annotations as they are. */
  confirm: z.boolean().optional(),
});

/**
 * Saves a person's annotations (the status becomes HUMAN_CONFIRMED, which later suggestions never
 * overwrite) and the exemplar flag. Codes must exist in the taxonomy; a post whose import source
 * forbids using it as an example (`improvePrompts = DENIED`, or RESTRICTED) cannot become one.
 */
export async function updateHistoricalPost(
  ctx: ServiceContext,
  raw: z.input<typeof UpdatePostInput>,
): Promise<PostRow> {
  const input = parseInput(UpdatePostInput, raw);
  const [post] = await ctx.db
    .select()
    .from(schema.historicalPosts)
    .where(eq(schema.historicalPosts.id, input.id));
  if (!post) throw new NotFoundError("Post not found.", { details: { id: input.id } });

  const patch = input.annotations ?? {};
  if (Object.keys(patch).length === 0 && input.isExemplar === undefined && !input.confirm) {
    throw new ValidationError("Nothing to save.", {
      fieldErrors: { _form: ["Change at least one field."] },
    });
  }
  const codes = await loadCodes(ctx);
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, kind] of Object.entries(KIND_OF)) {
    const value = patch[key as keyof typeof patch];
    if (value && !codes.get(kind)?.has(value)) {
      fieldErrors[`annotations.${key}`] = ["Choose a value from the list."];
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError("Unknown taxonomy code.", { fieldErrors });
  }

  if (input.isExemplar === true && !post.isExemplar && post.sourceAssetId) {
    const [source] = await ctx.db
      .select()
      .from(schema.sourceAssets)
      .where(eq(schema.sourceAssets.id, post.sourceAssetId));
    if (source && !canUseAsExemplar(source)) {
      throw new ValidationError(
        "The rights of this import do not allow using its posts as examples.",
        {
          fieldErrors: { isExemplar: ["Not allowed by the rights of the import."] },
        },
      );
    }
  }

  const annotations: PostAnnotations = { ...post.annotations };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete annotations[key as keyof PostAnnotations];
    else if (value !== undefined) annotations[key as keyof PostAnnotations] = value;
  }
  const annotationsChanged =
    Object.keys(patch).length > 0 &&
    JSON.stringify(annotations) !== JSON.stringify(post.annotations);
  const nothingToSet =
    Object.keys(patch).length === 0 &&
    input.isExemplar === undefined &&
    !(input.confirm && Object.keys(post.annotations).length > 0);
  if (nothingToSet) return toRow(post);
  const updated = await withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(schema.historicalPosts)
      .set({
        ...(Object.keys(patch).length > 0
          ? {
              annotations,
              annotationStatus: Object.keys(annotations).length
                ? ("HUMAN_CONFIRMED" as const)
                : ("NONE" as const),
            }
          : input.confirm && Object.keys(post.annotations).length > 0
            ? { annotationStatus: "HUMAN_CONFIRMED" as const }
            : {}),
        ...(input.isExemplar === undefined ? {} : { isExemplar: input.isExemplar }),
      })
      .where(eq(schema.historicalPosts.id, input.id))
      .returning();
    if (!row) throw new NotFoundError("Post not found.", { details: { id: input.id } });
    await audit(tx, {
      action: "posts.updated",
      entityType: "historical_post",
      entityId: row.id,
      data: {
        ...(annotationsChanged ? { annotations: Object.keys(patch) } : {}),
        ...(input.confirm ? { confirmed: true } : {}),
        ...(input.isExemplar === undefined ? {} : { isExemplar: input.isExemplar }),
      },
    });
    return row;
  });
  return toRow(updated);
}

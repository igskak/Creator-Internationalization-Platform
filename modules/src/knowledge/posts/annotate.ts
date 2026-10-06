import { schema } from "@rc/db";
import type { PostAnnotations, ValidationIssue } from "@rc/db/json";
import { and, asc, eq, inArray, ne } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import { postAnnotator } from "@rc/prompts";
import { z } from "zod";
import { runStage } from "../../ai";
import { audit, type ServiceContext, triggerJob, withTransaction } from "../../core";
import { canProcessWithAI } from "../rights";

// Annotation suggestions for historical posts (plan 06 J17, 07 §7.6, M1-23): the model proposes
// taxonomy codes from the caption, the person confirms. Nothing a person confirmed is ever
// overwritten, and a post whose import does not allow AI processing is never sent to a model.

type Output = postAnnotator.AnnotatorOutput;
type Post = typeof schema.historicalPosts.$inferSelect;

/** Posts per J17 run. */
const JOB_CHUNK = 50;
const { MAX_POSTS_PER_CALL } = postAnnotator;
/** Most posts one request for suggestions can cover. */
export const MAX_SUGGEST_POSTS = 200;

export type AnnotateSkipReason = "NOT_FOUND" | "CONFIRMED" | "NO_CAPTION" | "RIGHTS";
export type AnnotateResult = {
  /** Posts that got suggested codes (status AI_SUGGESTED). */
  suggested: number;
  /** Posts the model found nothing for. */
  empty: number;
  skipped: { id: string; reason: AnnotateSkipReason }[];
  /** Posts of a call whose answer could not be used; they can be tried again. */
  failed: string[];
};

const FIELDS = ["category", "angle", "hookType", "ctaType"] as const;

type Terms = postAnnotator.AnnotatorInput["taxonomy"];

async function loadTaxonomy(ctx: ServiceContext): Promise<Terms> {
  const rows = await ctx.db
    .select()
    .from(schema.taxonomyTerms)
    .where(
      and(
        inArray(schema.taxonomyTerms.kind, ["category", "angle", "hook_type", "cta_type"]),
        eq(schema.taxonomyTerms.isActive, true),
      ),
    )
    .orderBy(asc(schema.taxonomyTerms.sortOrder), asc(schema.taxonomyTerms.code));
  const of = (kind: string) =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => ({
        code: r.code,
        label: r.label,
        ...(r.description ? { description: r.description } : {}),
      }));
  return {
    categories: of("category"),
    angles: of("angle"),
    hookTypes: of("hook_type"),
    ctaTypes: of("cta_type"),
  };
}

/** The model must answer for every post exactly once (the code lists are enforced by the schema). */
export function validateAnnotations(output: Output, ids: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, number>();
  for (const a of output.annotations) seen.set(a.postId, (seen.get(a.postId) ?? 0) + 1);
  for (const id of ids) {
    const n = seen.get(id) ?? 0;
    if (n !== 1) {
      issues.push({
        code: n === 0 ? "POST_MISSING" : "POST_REPEATED",
        severity: "BLOCKER",
        fieldPath: "annotations",
        message: n === 0 ? `Post ${id} has no entry.` : `Post ${id} has ${n} entries.`,
        fixHint: "Return exactly one entry for each post.",
      });
    }
  }
  return issues;
}

export const AnnotatePostsInput = z.object({ postIds: z.array(z.uuid()).min(1).max(JOB_CHUNK) });

/**
 * J17 `annotate-historical-posts`: asks the model for codes for the given posts (ten per call).
 * Posts a person confirmed, posts without a caption and posts whose import forbids AI processing
 * are skipped. A suggestion is saved only where the post is still not confirmed at the moment of
 * saving, so a person who confirms while the job runs wins. Safe to run again.
 */
export async function annotateHistoricalPosts(
  ctx: ServiceContext,
  raw: z.input<typeof AnnotatePostsInput>,
): Promise<AnnotateResult> {
  const parsed = AnnotatePostsInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const ids = [...new Set(parsed.data.postIds)];
  const result: AnnotateResult = { suggested: 0, empty: 0, skipped: [], failed: [] };

  const posts = new Map(
    (
      await ctx.db
        .select()
        .from(schema.historicalPosts)
        .where(inArray(schema.historicalPosts.id, ids))
    ).map((p) => [p.id, p]),
  );
  const sourceIds = [...new Set([...posts.values()].map((p) => p.sourceAssetId).filter(Boolean))];
  const sources = new Map(
    (sourceIds.length
      ? await ctx.db
          .select()
          .from(schema.sourceAssets)
          .where(inArray(schema.sourceAssets.id, sourceIds as string[]))
      : []
    ).map((s) => [s.id, s]),
  );

  const todo: Post[] = [];
  for (const id of ids) {
    const post = posts.get(id);
    const skip = (reason: AnnotateSkipReason) => result.skipped.push({ id, reason });
    if (!post) skip("NOT_FOUND");
    else if (post.annotationStatus === "HUMAN_CONFIRMED") skip("CONFIRMED");
    else if (!(post.caption ?? "").trim()) skip("NO_CAPTION");
    else {
      const source = post.sourceAssetId ? sources.get(post.sourceAssetId) : undefined;
      if (!source || !canProcessWithAI(source)) skip("RIGHTS");
      else todo.push(post);
    }
  }
  if (todo.length === 0) return result;

  const taxonomy = await loadTaxonomy(ctx);
  const byLanguage = new Map<string, Post[]>();
  for (const post of todo) {
    const language = post.language ?? "ru";
    byLanguage.set(language, [...(byLanguage.get(language) ?? []), post]);
  }

  for (const [language, group] of byLanguage) {
    for (let i = 0; i < group.length; i += MAX_POSTS_PER_CALL) {
      const batch = group.slice(i, i + MAX_POSTS_PER_CALL);
      const batchIds = batch.map((p) => p.id);
      const stage = await runStage<Output>(ctx, {
        stage: "POST_ANNOTATION",
        input: {
          language,
          taxonomy,
          posts: batch.map((p) => ({ id: p.id, format: p.format, caption: p.caption ?? "" })),
        },
        validate: (output) => validateAnnotations(output, batchIds),
      });
      if (!stage.data) {
        result.failed.push(...batchIds);
        continue;
      }
      for (const a of stage.data.annotations) {
        const codes: PostAnnotations = {};
        for (const field of FIELDS) {
          const code = a[field];
          if (code) codes[field] = code;
        }
        if (Object.keys(codes).length === 0) {
          result.empty++;
          continue;
        }
        const saved = await withTransaction(ctx, async (tx) => {
          const [row] = await tx.db
            .update(schema.historicalPosts)
            .set({ annotations: codes, annotationStatus: "AI_SUGGESTED" })
            // A person's confirmation always wins, even one made while this job was running.
            .where(
              and(
                eq(schema.historicalPosts.id, a.postId),
                ne(schema.historicalPosts.annotationStatus, "HUMAN_CONFIRMED"),
              ),
            )
            .returning({ id: schema.historicalPosts.id });
          if (row) {
            await audit(tx, {
              action: "posts.annotation_suggested",
              entityType: "historical_post",
              entityId: row.id,
              data: { runId: stage.runId, fields: Object.keys(codes) },
            });
          }
          return Boolean(row);
        });
        if (saved) result.suggested++;
        else result.skipped.push({ id: a.postId, reason: "CONFIRMED" });
      }
    }
  }
  return result;
}

export const RequestAnnotationsInput = z.object({
  /** Given: those posts. Not given: posts that have no annotation yet, newest first. */
  postIds: z.array(z.uuid()).max(MAX_SUGGEST_POSTS).optional(),
});

/**
 * Starts J17 for the given posts, or for posts without any annotation (at most 200 per request,
 * 50 per job). Returns how many posts were queued.
 */
export async function requestPostAnnotations(
  ctx: ServiceContext,
  raw: z.input<typeof RequestAnnotationsInput> = {},
): Promise<{ requested: number }> {
  const parsed = RequestAnnotationsInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const ids =
    parsed.data.postIds ??
    (
      await ctx.db
        .select({ id: schema.historicalPosts.id })
        .from(schema.historicalPosts)
        .where(eq(schema.historicalPosts.annotationStatus, "NONE"))
        .orderBy(schema.historicalPosts.postedAt)
        .limit(MAX_SUGGEST_POSTS)
    ).map((r) => r.id);
  for (let i = 0; i < ids.length; i += JOB_CHUNK) {
    await triggerJob(ctx, "annotate-historical-posts", { postIds: ids.slice(i, i + JOB_CHUNK) });
  }
  return { requested: ids.length };
}

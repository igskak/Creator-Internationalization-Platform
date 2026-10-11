import { schema } from "@rc/db";
import type { InstagramError } from "@rc/db/json";
import { and, desc, eq, inArray } from "@rc/db/orm";
import { NotFoundError } from "@rc/lib/errors";
import { z } from "zod";
import type { ServiceContext } from "../core";
import { isMediaFetchFailure } from "../instagram";
import type { GUARD_CODES } from "./safeguards";

// What the publication drawer and the review screen show (plan 05 §5.8 getPublication, 10 §10.4,
// M5-09): the publication, its calls to Instagram in order, a readable error with the next step.

/**
 * What kind of failure this is, as a key the UI turns into words in the person's language:
 * the Instagram error classes, `INVALID_MEDIA_FETCH`, `MANUAL_CHECK_REQUIRED`, or `GUARD_<CODE>`.
 */
export type ErrorKind =
  | InstagramError["classification"]
  | "INVALID_MEDIA_FETCH"
  | "MANUAL_CHECK_REQUIRED"
  | `GUARD_${(typeof GUARD_CODES)[number]}`;

export function errorKind(error: InstagramError): ErrorKind {
  if (error.type === "MANUAL_CHECK_REQUIRED") return "MANUAL_CHECK_REQUIRED";
  if (error.type?.startsWith("GUARD_")) return error.type as ErrorKind;
  if (isMediaFetchFailure(error)) return "INVALID_MEDIA_FETCH";
  return error.classification;
}

export type PublicationError = {
  kind: ErrorKind;
  classification: InstagramError["classification"];
  /** The message as it came (English; shown under "technical details"). */
  message: string;
  code: number | null;
  subcode: number | null;
  fbtraceId: string | null;
};

const toPublicationError = (error: InstagramError): PublicationError => ({
  kind: errorKind(error),
  classification: error.classification,
  message: error.message,
  code: error.code ?? null,
  subcode: error.subcode ?? null,
  fbtraceId: error.fbtraceId ?? null,
});

export type PublicationAttempt = {
  id: number;
  at: Date;
  attemptNo: number;
  step: string;
  /** Path only, e.g. `/1784/media_publish`. */
  endpoint: string;
  httpStatus: number | null;
  outcome: "OK" | "TRANSIENT_ERROR" | "PERMANENT_ERROR" | "AMBIGUOUS";
  errorCode: string | null;
  errorSubcode: string | null;
  fbtraceId: string | null;
  durationMs: number | null;
};

export type PublicationDetails = {
  id: string;
  variantId: string;
  ideaId: string;
  title: string | null;
  status: (typeof schema.publications.$inferSelect)["status"];
  mode: "IMMEDIATE" | "SCHEDULED";
  dryRun: boolean;
  step: string | null;
  retryNo: number;
  attemptCount: number;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  permalink: string | null;
  market: { code: string; name: string; flagEmoji: string | null; timezone: string };
  account: { username: string } | null;
  error: PublicationError | null;
  attempts: PublicationAttempt[];
  canRetry: boolean;
  canCancel: boolean;
};

export const GetPublicationInput = z.object({ publicationId: z.uuid() });

export async function getPublicationDetails(
  ctx: ServiceContext,
  raw: z.input<typeof GetPublicationInput>,
): Promise<PublicationDetails> {
  const { publicationId } = GetPublicationInput.parse(raw);
  const [row] = await ctx.db
    .select({
      publication: schema.publications,
      market: schema.markets,
      ideaId: schema.contentVariants.masterIdeaId,
      snapshot: schema.contentVariantVersions.snapshot,
    })
    .from(schema.publications)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.publications.marketId))
    .innerJoin(
      schema.contentVariants,
      eq(schema.contentVariants.id, schema.publications.contentVariantId),
    )
    .innerJoin(
      schema.contentVariantVersions,
      eq(schema.contentVariantVersions.id, schema.publications.contentVariantVersionId),
    )
    .where(eq(schema.publications.id, publicationId));
  if (!row) throw new NotFoundError("Publication not found.", { details: { publicationId } });
  const { publication: p, market } = row;
  const [account] = p.socialAccountId
    ? await ctx.db
        .select({ username: schema.socialAccounts.username })
        .from(schema.socialAccounts)
        .where(eq(schema.socialAccounts.id, p.socialAccountId))
    : [];
  const attempts = await ctx.db
    .select()
    .from(schema.publishAttempts)
    .where(eq(schema.publishAttempts.publicationId, p.id))
    .orderBy(schema.publishAttempts.createdAt, schema.publishAttempts.id);
  return {
    id: p.id,
    variantId: p.contentVariantId,
    ideaId: row.ideaId,
    title: row.snapshot.hook || null,
    status: p.status,
    mode: p.mode,
    dryRun: p.dryRun,
    step: p.step,
    retryNo: p.retryNo,
    attemptCount: p.attemptCount,
    scheduledAt: p.scheduledAt,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
    permalink: p.permalink,
    market: {
      code: market.code,
      name: market.displayName,
      flagEmoji: market.flagEmoji,
      timezone: market.timezone,
    },
    account: account ?? null,
    error: p.lastError ? toPublicationError(p.lastError) : null,
    attempts: attempts.map((a) => ({
      id: a.id,
      at: a.createdAt,
      attemptNo: a.attemptNo,
      step: a.step,
      endpoint: a.endpoint,
      httpStatus: a.httpStatus,
      outcome: a.outcome,
      errorCode: a.errorCode,
      errorSubcode: a.errorSubcode,
      fbtraceId: a.fbtraceId,
      durationMs: a.durationMs,
    })),
    canRetry: p.status === "FAILED",
    canCancel: p.status === "SCHEDULED" || p.status === "QUEUED",
  };
}

export type PublicationSummary = {
  id: string;
  status: PublicationDetails["status"];
  dryRun: boolean;
  step: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  permalink: string | null;
  error: PublicationError | null;
};

export type VariantPublications = {
  /** The newest real (not dry-run) post, whatever its state. */
  current: PublicationSummary | null;
  /** The newest dry run. */
  lastDryRun: PublicationSummary | null;
};

/** The newest post and the newest dry run of each variant: the "Publishing" panel of the review screen. */
export async function listVariantPublications(
  ctx: ServiceContext,
  variantIds: readonly string[],
): Promise<Record<string, VariantPublications>> {
  const result: Record<string, VariantPublications> = Object.fromEntries(
    variantIds.map((id) => [id, { current: null, lastDryRun: null }]),
  );
  if (variantIds.length === 0) return result;
  const rows = await ctx.db
    .select()
    .from(schema.publications)
    .where(and(inArray(schema.publications.contentVariantId, [...variantIds])))
    .orderBy(desc(schema.publications.createdAt));
  for (const p of rows) {
    const entry = result[p.contentVariantId];
    if (!entry) continue;
    const summary: PublicationSummary = {
      id: p.id,
      status: p.status,
      dryRun: p.dryRun,
      step: p.step,
      scheduledAt: p.scheduledAt,
      publishedAt: p.publishedAt,
      permalink: p.permalink,
      error: p.lastError ? toPublicationError(p.lastError) : null,
    };
    // Cancelled posts are history: the panel is about what stands now.
    if (p.dryRun) entry.lastDryRun ??= summary;
    else if (p.status !== "CANCELLED") entry.current ??= summary;
  }
  return result;
}

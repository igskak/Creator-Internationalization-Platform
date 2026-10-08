import { performance } from "node:perf_hooks";
import { schema } from "@rc/db";
import type { KnowledgeSnapshot } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import type { EmbeddingProvider } from "@rc/lib/providers/embeddings";
import type { LLMProvider } from "@rc/lib/providers/llm";
import { generationVersion, runStage } from "@rc/modules/ai";
import { generateVariants, getReviewBundle, type VariantView } from "@rc/modules/content";
import { createServiceContext, type ServiceContext } from "@rc/modules/core";
import "@rc/modules/job-handlers"; // registers the job names the services trigger (types)
import type { evalJudge } from "@rc/prompts";
import type { EvalCase } from "./case";

// Runs one eval case through the real variant pipeline in a throw-away database (PGlite): the
// case's cards are seeded as approved, the idea as accepted, the variants are written and
// reviewed exactly as in production, and what came out is collected for the metrics (07 §7.12).
// The model and the embeddings are the ones given, so a fake model costs nothing.

type Judgement = evalJudge.EvalJudgeOutput;

export type RunRow = {
  stage: string;
  status: string;
  costUsd: number | null;
  latencyMs: number | null;
  repairAttempts: number;
};

export type CaseOutcome = {
  case: EvalCase;
  /** Card key → the id the run gave it. */
  cardIds: Record<string, string>;
  variants: VariantView[];
  runs: RunRow[];
  /** Per market code; absent when the judge did not run. */
  judgements: Record<string, Judgement | { error: string }>;
  /** Wall time of the pipeline (not the judge), in ms. */
  pipelineMs: number;
  /** Cost of the pipeline runs, null when a run is not priced. */
  pipelineCostUsd: number | null;
  judgeCostUsd: number | null;
  /** Variants the pipeline could not finish. */
  failed: { marketCode: string; code: string; message: string }[];
};

export type RunOptions = {
  llm: LLMProvider;
  embeddings: EmbeddingProvider;
  /** Score every finished variant with `eval-judge@1`. */
  judge: boolean;
};

const silent = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

const snapshotOf = (card: EvalCase["cards"][number]): KnowledgeSnapshot => ({
  title: card.title,
  category: card.category,
  subcategory: null,
  claim: card.claim,
  explanation: card.explanation,
  procedure: card.procedure,
  ingredients: card.ingredients,
  temperatures: card.temperatures,
  timings: card.timings,
  commonMistakes: card.commonMistakes,
  sourceReference: null,
  language: card.language,
  safetySensitive: card.safetySensitive,
  safetyNotes: card.safetyNotes,
  tags: [],
});

const sumCost = (rows: readonly { costUsd: number | null }[]): number | null =>
  rows.some((r) => r.costUsd === null) ? null : rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

export async function runCase(evalCase: EvalCase, options: RunOptions): Promise<CaseOutcome> {
  const t = await createTestDb();
  try {
    await seedDatabase(t.db, { ownerEmails: ["eval@example.com"] });
    const ctx: ServiceContext = createServiceContext({
      db: t.db,
      logger: silent,
      llm: options.llm,
      embeddings: options.embeddings,
      actor: { type: "SYSTEM" },
    });

    const [brand] = await t.db.select().from(schema.brands);
    const brandId = brand?.id ?? "";
    await t.db
      .update(schema.brands)
      .set({ brandVoice: evalCase.brandVoice })
      .where(eq(schema.brands.id, brandId));
    for (const [code, notes] of Object.entries(evalCase.marketNotes)) {
      await t.db
        .update(schema.markets)
        .set({
          ...(notes.toneNotes !== undefined ? { toneNotes: notes.toneNotes } : {}),
          ...(notes.foodCultureNotes !== undefined
            ? { foodCultureNotes: notes.foodCultureNotes }
            : {}),
          ...(notes.preferredVocabulary ? { preferredVocabulary: notes.preferredVocabulary } : {}),
          ...(notes.forbiddenPatterns ? { forbiddenPatterns: notes.forbiddenPatterns } : {}),
        })
        .where(eq(schema.markets.code, code));
    }

    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "NOTE",
        title: `eval ${evalCase.id}`,
        originalLanguage: evalCase.cards[0]?.language ?? "ru",
        rights: {
          use: "ALLOWED",
          translate: "ALLOWED",
          adapt: "ALLOWED",
          visuallyTransform: "UNKNOWN",
          sell: "UNKNOWN",
          aiProcessing: "ALLOWED",
          improvePrompts: "UNKNOWN",
        },
        processingStatus: "READY",
      })
      .returning({ id: schema.sourceAssets.id });
    const cardIds: Record<string, string> = {};
    for (const card of evalCase.cards) {
      const [row] = await t.db
        .insert(schema.knowledgeItems)
        .values({
          brandId,
          title: card.title,
          category: card.category,
          claim: card.claim,
          explanation: card.explanation,
          procedureJson: card.procedure,
          ingredientsJson: card.ingredients,
          temperaturesJson: card.temperatures,
          timingsJson: card.timings,
          commonMistakesJson: card.commonMistakes,
          safetySensitive: card.safetySensitive,
          safetyNotes: card.safetyNotes,
          language: card.language,
          origin: "MANUAL",
          reviewStatus: "CHEF_APPROVED",
          version: 1,
          approvedVersion: 1,
          approvedAt: new Date(),
          sourceAssetId: source?.id ?? null,
        })
        .returning({ id: schema.knowledgeItems.id });
      cardIds[card.key] = row?.id ?? "";
      await t.db.insert(schema.knowledgeItemVersions).values({
        knowledgeItemId: row?.id ?? "",
        version: 1,
        status: "CHEF_APPROVED",
        snapshot: snapshotOf(card),
      });
    }
    const [idea] = await t.db
      .insert(schema.masterIdeas)
      .values({
        brandId,
        topic: evalCase.idea.topic,
        category: evalCase.idea.category,
        angle: evalCase.idea.angle,
        coreMessage: evalCase.idea.coreMessage,
        status: "ACCEPTED",
        origin: "MANUAL",
      })
      .returning({ id: schema.masterIdeas.id });
    const ideaId = idea?.id ?? "";
    await t.db.insert(schema.masterIdeaKnowledge).values(
      evalCase.cards.map((card) => ({
        masterIdeaId: ideaId,
        knowledgeItemId: cardIds[card.key] ?? "",
        knowledgeVersion: 1,
        role: card.role,
      })),
    );

    const variantIds: string[] = [];
    for (const code of evalCase.markets) {
      const [market] = await t.db
        .select()
        .from(schema.markets)
        .where(eq(schema.markets.code, code));
      if (!market) throw new Error(`${evalCase.id}: the market "${code}" is not set up.`);
      const [variant] = await t.db
        .insert(schema.contentVariants)
        .values({ masterIdeaId: ideaId, marketId: market.id })
        .returning({ id: schema.contentVariants.id });
      variantIds.push(variant?.id ?? "");
    }

    const started = performance.now();
    const result = await generateVariants(ctx, {
      masterIdeaId: ideaId,
      variantIds,
      pipelineRunId: `eval-${evalCase.id}`,
    });
    const pipelineMs = Math.round(performance.now() - started);
    const bundle = await getReviewBundle(ctx, ideaId);
    const runs: RunRow[] = (
      await t.db
        .select()
        .from(schema.generationRuns)
        .where(eq(schema.generationRuns.masterIdeaId, ideaId))
    ).map((r) => ({
      stage: r.stage,
      status: r.status,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
      latencyMs: r.latencyMs,
      repairAttempts: r.repairAttempts,
    }));

    const judgements: CaseOutcome["judgements"] = {};
    const judgeRuns: { costUsd: number | null }[] = [];
    if (options.judge) {
      for (const variant of bundle.variants.filter((v) => v.hasContent)) {
        const market = await t.db
          .select()
          .from(schema.markets)
          .where(eq(schema.markets.code, variant.marketCode));
        const stage = await runStage<Judgement>(ctx, {
          stage: "EVAL_JUDGE",
          input: {
            brandVoice: evalCase.brandVoice,
            idea: { topic: evalCase.idea.topic, coreMessage: evalCase.idea.coreMessage },
            cards: evalCase.cards.map((c) => ({
              id: cardIds[c.key] ?? c.key,
              title: c.title,
              claim: c.claim,
              explanation: c.explanation,
              language: c.language,
            })),
            market: {
              code: variant.marketCode,
              displayName: variant.marketName,
              language: market[0]?.language ?? "en",
              toneNotes: market[0]?.toneNotes ?? "",
            },
            draft: {
              hook: variant.hook ?? "",
              slides: variant.slides.map((s) => ({
                role: s.role,
                text: Object.values(s.slots).join(" "),
                cites: s.knowledgeIds,
              })),
              caption: variant.caption ?? "",
              cta: variant.cta?.text ?? "",
              hashtags: variant.hashtags,
            },
          },
          validate: (output) =>
            Object.entries(output.scores)
              .filter(([, value]) => !Number.isFinite(value) || value < 1 || value > 5)
              .map(([name, value]) => ({
                code: "SCORE_OUT_OF_RANGE",
                severity: "BLOCKER" as const,
                fieldPath: `scores.${name}`,
                message: `The score ${name} is ${value}, it must be 1–5.`,
                fixHint: "Give every score as a whole number from 1 to 5.",
              })),
        });
        judgeRuns.push({ costUsd: stage.costUsd });
        judgements[variant.marketCode] = stage.data ?? {
          error: `The judge answered ${stage.status}.`,
        };
      }
    }

    return {
      case: evalCase,
      cardIds,
      variants: bundle.variants,
      runs,
      judgements,
      pipelineMs,
      pipelineCostUsd: sumCost(runs),
      judgeCostUsd: options.judge ? sumCost(judgeRuns) : 0,
      failed: result.outcomes.flatMap((o) =>
        o.status === "FAILED"
          ? [
              {
                marketCode: o.marketCode,
                code: o.error?.code ?? "FAILED",
                message: o.error?.message ?? "",
              },
            ]
          : [],
      ),
    };
  } finally {
    await t.close();
  }
}

export { generationVersion };

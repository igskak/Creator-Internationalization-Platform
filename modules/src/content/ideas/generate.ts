import type { ValidationIssue } from "@rc/db/json";
import type { LLMUsage } from "@rc/lib/providers/llm";
import type { ideaGenerator } from "@rc/prompts";
import { runStage, STAGE_CONFIG, type StageStatus } from "../../ai";
import type { ServiceContext } from "../../core";
import { ideasUseMemory, latestMemory, memoryForIdeas } from "../learning";
import { buildIdeaContext, type IdeaContextOptions } from "./context";
import { diversifyIdeas, overAsk } from "./diversity";
import { findOverusedThemes } from "./overuse";
import { type DroppedIdea, dropNearDuplicates, validateIdeaOutput } from "./validate";

type Output = ideaGenerator.IdeaGeneratorOutput;

export type IdeaDraftsResult = {
  /** SUCCEEDED or REPAIRED when ideas were produced; INVALID_OUTPUT or REFUSED otherwise. */
  status: StageStatus;
  /** Valid ideas that are not repeats; empty unless the model answered usably. */
  ideas: ideaGenerator.IdeaDraft[];
  /** Ideas left out because they repeat a recent idea or an earlier one of the batch. */
  dropped: DroppedIdea[];
  /** Valid ideas beyond the count asked for that the diversity pick left out (M7-05). */
  notPicked: ideaGenerator.IdeaDraft[];
  /** Non-blocking issues of the answer (blocking ones when the status is INVALID_OUTPUT). */
  issues: ValidationIssue[];
  runIds: string[];
  usage: LLMUsage;
  costUsd: number | null;
  /** The performance summary the model was given (M7-04); null when none was used. */
  performanceSummaryId: string | null;
  /** Cards the model was allowed to cite, with the pool statistics. */
  context: {
    cardIds: string[];
    /** Approved version of each card as the model saw it (what an idea is linked to). */
    cardVersions: Record<string, number>;
    poolMatched: number;
    exclusionApplied: boolean;
    recentIdeaCount: number;
  };
};

/**
 * Asks the idea generator for ideas and checks the answer: ids inside the pool, existing
 * products, one repair for blocking problems (`runStage`), then near-duplicates of recent ideas
 * are dropped. Nothing is saved here: M2-07 stores the drafts as `master_ideas` with their links.
 */
export async function generateIdeaDrafts(
  ctx: ServiceContext,
  options: IdeaContextOptions & {
    /** The idea-generator version to run; default the active one (`STAGE_CONFIG`). */
    promptVersion?: number;
  },
): Promise<IdeaDraftsResult> {
  const { promptVersion = STAGE_CONFIG.IDEA_GENERATION.version, ...contextOptions } = options;
  // The memory across markets goes only to a version that has the rules for it (M7-04).
  const memory = ideasUseMemory(promptVersion) ? await latestMemory(ctx, null) : null;
  // M7-05: ask for a few more ideas than wanted; the most diverse `count` are kept below.
  const wanted = contextOptions.count;
  const { input, pool } = await buildIdeaContext(ctx, {
    ...contextOptions,
    count: overAsk(wanted),
    ...(memory ? { performanceMemory: memoryForIdeas(memory.memory) } : {}),
  });
  const cardIds = input.cards.map((c) => c.id);
  const validation = {
    cardIds: new Set(cardIds),
    productCodes: new Set(input.offers.map((o) => o.productCode)),
    count: input.count,
  };
  const stage = await runStage<Output>(ctx, {
    stage: "IDEA_GENERATION",
    config: { version: promptVersion },
    input,
    inputRefs: { knowledgeItemIds: cardIds },
    validate: (output) => validateIdeaOutput(output, validation),
  });
  const context = {
    cardIds,
    cardVersions: Object.fromEntries(input.cards.map((c) => [c.id, c.version])),
    poolMatched: pool.matched,
    exclusionApplied: pool.exclusionApplied,
    recentIdeaCount: input.recentIdeas.length,
  };
  const base = {
    status: stage.status,
    issues: stage.issues,
    runIds: stage.runIds,
    usage: stage.usage,
    costUsd: stage.costUsd,
    performanceSummaryId: memory?.summaryId ?? null,
    context,
  };
  if (!stage.data) return { ...base, ideas: [], dropped: [], notPicked: [] };

  const { kept, dropped } = await dropNearDuplicates(
    ctx.embeddings,
    stage.data.ideas,
    input.recentIdeas.map((i) => i.coreMessage),
  );
  const diverse = await diversifyIdeas(ctx.embeddings, kept, {
    count: wanted,
    overused: await findOverusedThemes(ctx),
  });
  return { ...base, ideas: diverse.kept, dropped, notPicked: diverse.left };
}

"use server";

import {
  CreateManualIdeaInput,
  createManualIdea as createManualService,
  GenerateIdeasInput,
  GenerateVariantsInput,
  generateIdeas as generateService,
  getIdeasRequestStatus,
  RegenerateAllInput,
  RegenerateVariantInput,
  RegenerateVisualBriefInput,
  regenerateVisualBrief as regenerateVisualBriefService,
  requestIdeaRegeneration,
  requestVariantRegeneration,
  requestVariants,
  SearchCardsInput,
  searchCardsForIdea,
  TransitionIdeaInput,
  transitionIdea as transitionService,
  UpdateIdeaInput,
  updateIdea as updateService,
} from "@rc/modules/content";
import { triggerJob } from "@rc/modules/core";
import { GenerateVisualAssetsPayload, RunVisualQaPayload } from "@rc/modules/visuals";
import { z } from "zod";
import { defineAction } from "./_define";

// Plan 05 §5.6. Every signed-in role may work with ideas; the services check the rules.

export const generateIdeas = defineAction({
  name: "generateIdeas",
  input: GenerateIdeasInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => generateService(ctx, input),
});

/** Polled by the ideas screen after `generateIdeas` until the state is DONE or FAILED. */
export const getIdeasRequest = defineAction({
  name: "getIdeasRequest",
  input: z.object({ requestId: z.uuid() }),
  roles: ["owner", "editor", "chef"],
  handler: (ctx, { requestId }) => getIdeasRequestStatus(ctx, requestId),
});

export const createManualIdea = defineAction({
  name: "createManualIdea",
  input: CreateManualIdeaInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const idea = await createManualService(ctx, input);
    return { id: idea.id, status: idea.status };
  },
});

export const updateIdea = defineAction({
  name: "updateIdea",
  input: UpdateIdeaInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const idea = await updateService(ctx, input);
    return { id: idea.id, status: idea.status };
  },
});

export const transitionIdea = defineAction({
  name: "transitionIdea",
  input: TransitionIdeaInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const idea = await transitionService(ctx, input);
    return { id: idea.id, status: idea.status };
  },
});

/** The card picker of the idea form: approved cards, newest first, filtered by a text search. */
export const searchIdeaCards = defineAction({
  name: "searchIdeaCards",
  input: SearchCardsInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => searchCardsForIdea(ctx, input),
});

// Plan 05 §5.6, §5.7: the pipeline runs as the job J5; the actions only queue it.

export const generateVariants = defineAction({
  name: "generateVariants",
  input: GenerateVariantsInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => requestVariants(ctx, input),
});

export const regenerateVariant = defineAction({
  name: "regenerateVariant",
  input: RegenerateVariantInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => requestVariantRegeneration(ctx, input),
});

export const regenerateAllVariants = defineAction({
  name: "regenerateAllVariants",
  input: RegenerateAllInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => requestIdeaRegeneration(ctx, input),
});

export const regenerateVisualBrief = defineAction({
  name: "regenerateVisualBrief",
  input: RegenerateVisualBriefInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => regenerateVisualBriefService(ctx, input),
});

/** Starts J7 for one variant: all its pictures, or only the given slots (retry of failed ones). */
export const generateVisualAssets = defineAction({
  name: "generateVisualAssets",
  input: GenerateVisualAssetsPayload,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const { runId } = await triggerJob(ctx, "generate-visual-assets", input);
    return { jobRunId: runId };
  },
});

/** Starts the vision check (J21) of a variant's rendered slides; the findings join its critic report. */
export const runVisualQa = defineAction({
  name: "runVisualQa",
  input: RunVisualQaPayload,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const { runId } = await triggerJob(ctx, "run-visual-qa", input);
    return { jobRunId: runId };
  },
});

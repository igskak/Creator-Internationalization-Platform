"use server";

import {
  ApproveVariantInput,
  approveVariant as approveVariantService,
  CreateManualIdeaInput,
  createManualIdea as createManualService,
  EditVariantFieldInput,
  editVariantField as editVariantFieldService,
  GenerateIdeasInput,
  GenerateVariantsInput,
  generateIdeas as generateService,
  getIdeasRequestStatus,
  RegenerateAllInput,
  RegenerateVariantFieldInput,
  RegenerateVariantInput,
  RegenerateVisualBriefInput,
  RejectVariantInput,
  RequestChangesInput,
  ResubmitVariantInput,
  regenerateVisualBrief as regenerateVisualBriefService,
  rejectVariant as rejectVariantService,
  requestChanges as requestChangesService,
  requestFieldRegeneration,
  requestIdeaRegeneration,
  requestVariantRegeneration,
  requestVariants,
  resubmitVariant as resubmitVariantService,
  SearchCardsInput,
  searchCardsForIdea,
  TransitionIdeaInput,
  transitionIdea as transitionService,
  UnapproveVariantInput,
  UpdateIdeaInput,
  unapproveVariant as unapproveVariantService,
  updateIdea as updateService,
} from "@rc/modules/content";
import { triggerJob } from "@rc/modules/core";
import {
  GenerateVisualAssetsPayload,
  RunVisualQaPayload,
  requestRender,
} from "@rc/modules/visuals";
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

// Plan 05 §5.7: one field of a variant is edited; the service checks the value, the lock version
// and (for an approved variant) the confirmation.

export const editVariantField = defineAction({
  name: "editVariantField",
  input: EditVariantFieldInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const result = await editVariantFieldService(ctx, input);
    return {
      status: result.variant.status,
      lockVersion: result.variant.lockVersion,
      reviewEventId: result.reviewEventId,
      warnings: result.warnings,
      cancelledPublicationIds: result.cancelledPublicationIds,
      renderQueued: result.renderQueued,
    };
  },
});

// Plan 05 §5.7: the model redoes one field (job J6); the result arrives as a REGENERATE review event.

export const regenerateVariantField = defineAction({
  name: "regenerateVariantField",
  input: RegenerateVariantFieldInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => requestFieldRegeneration(ctx, input),
});

// Plan 05 §5.7: the reviewer's decisions. Every signed-in role may take them; the services check
// the state machine, the reasons and (for approval) the guards of 10 §10.4.3.

const slim = (v: { status: string; lockVersion: number }) => ({
  status: v.status,
  lockVersion: v.lockVersion,
});

export const approveVariant = defineAction({
  name: "approveVariant",
  input: ApproveVariantInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const result = await approveVariantService(ctx, input);
    return { ...slim(result.variant), versionId: result.versionId, versionNo: result.versionNo };
  },
});

export const requestChanges = defineAction({
  name: "requestChanges",
  input: RequestChangesInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => slim(await requestChangesService(ctx, input)),
});

export const resubmitVariant = defineAction({
  name: "resubmitVariant",
  input: ResubmitVariantInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => slim(await resubmitVariantService(ctx, input)),
});

export const rejectVariant = defineAction({
  name: "rejectVariant",
  input: RejectVariantInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => slim(await rejectVariantService(ctx, input)),
});

export const unapproveVariant = defineAction({
  name: "unapproveVariant",
  input: UnapproveVariantInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => slim(await unapproveVariantService(ctx, input)),
});

/** Queues the render of the draft as it is now (a no-op when a READY render of the same input exists). */
export const triggerRender = defineAction({
  name: "triggerRender",
  input: z.object({ variantId: z.uuid() }),
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, { variantId }) => {
    const { jobRunId } = await requestRender(ctx, variantId);
    return { jobRunId };
  },
});

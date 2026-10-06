"use server";

import {
  BulkTransitionInput,
  bulkTransitionKnowledgeCards as bulkTransitionService,
  CreateManualCardInput,
  createManualKnowledgeCard as createManualService,
  MergeDuplicatesInput,
  mergeDuplicateCards as mergeService,
  TransitionCardInput,
  transitionKnowledgeCard as transitionService,
  UpdateCardInput,
  updateKnowledgeCard as updateService,
} from "@rc/modules/knowledge";
import { defineAction } from "./_define";

// Plan 05 §5.4. The service enforces who may approve or restore (chef, owner) and archive an
// approved card (chef, owner); every signed-in role may call these actions.

export const transitionKnowledgeCard = defineAction({
  name: "transitionKnowledgeCard",
  input: TransitionCardInput,
  roles: ["owner", "editor", "chef"],
  // Only plain fields go back to the browser, not the whole row with embeddings.
  handler: async (ctx, input) => {
    const card = await transitionService(ctx, input);
    return { id: card.id, status: card.reviewStatus };
  },
});

export const bulkTransitionKnowledgeCards = defineAction({
  name: "bulkTransitionKnowledgeCards",
  input: BulkTransitionInput,
  roles: ["owner", "editor", "chef"],
  handler: (ctx, input) => bulkTransitionService(ctx, input),
});

export const updateKnowledgeCard = defineAction({
  name: "updateKnowledgeCard",
  input: UpdateCardInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const card = await updateService(ctx, input);
    return { id: card.id, status: card.status, version: card.version };
  },
});

export const createManualKnowledgeCard = defineAction({
  name: "createManualKnowledgeCard",
  input: CreateManualCardInput,
  roles: ["owner", "editor", "chef"],
  handler: async (ctx, input) => {
    const card = await createManualService(ctx, input);
    return { id: card.id };
  },
});

export const mergeDuplicateCards = defineAction({
  name: "mergeDuplicateCards",
  input: MergeDuplicatesInput,
  roles: ["owner", "chef"],
  handler: (ctx, input) => mergeService(ctx, input),
});

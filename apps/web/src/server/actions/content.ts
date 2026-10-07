"use server";

import {
  CreateManualIdeaInput,
  createManualIdea as createManualService,
  GenerateIdeasInput,
  generateIdeas as generateService,
  getIdeasRequestStatus,
  TransitionIdeaInput,
  transitionIdea as transitionService,
  UpdateIdeaInput,
  updateIdea as updateService,
} from "@rc/modules/content";
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

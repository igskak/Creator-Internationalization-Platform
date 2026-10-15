"use server";

import { getDraftProgress, getActivity as readActivity } from "@rc/modules/content";
import { z } from "zod";
import { defineAction } from "./_define";

/** The steps of every draft of one idea: the review page's poll while something runs (M6-10). */
export const getProgress = defineAction({
  name: "getProgress",
  input: z.object({ ideaId: z.uuid() }),
  handler: (ctx, input) => getDraftProgress(ctx, input.ideaId),
});

/** How many drafts and renders are running now: the header indicator's poll. */
export const getActivity = defineAction({
  name: "getActivity",
  input: z.object({}),
  handler: (ctx) => readActivity(ctx),
});

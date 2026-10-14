"use server";

import {
  ChangeReelHookInput,
  changeReelHook as changeReelHookService,
  EstimateReelInput,
  estimateReelCost,
  RegenerateReelShotInput,
  RequestReelInput,
  regenerateReelShot as regenerateReelShotService,
  requestReel,
} from "@rc/modules/reels";
import { defineAction } from "./_define";

// Actions of the Reel card (plan 18 §18.6, M8-07). Thin: validate, one service. They spend money
// (shots), so only an owner or an editor may call them.

/** The estimate the dialog shows: what a Reel of this carousel costs on a model, and whether the button is open. */
export const estimateReel = defineAction({
  name: "estimateReel",
  input: EstimateReelInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => estimateReelCost(ctx, input),
});

/** Generate Reel: needs the estimate the owner confirmed; queues J23. */
export const generateReel = defineAction({
  name: "generateReel",
  input: RequestReelInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => requestReel(ctx, input),
});

/** Another hook option for the Reel: free, the video is rebuilt from the same shots. */
export const changeReelHook = defineAction({
  name: "changeReelHook",
  input: ChangeReelHookInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => changeReelHookService(ctx, input),
});

/** One shot again (the price of one shot, confirmed), then the video is rebuilt. */
export const regenerateReelShot = defineAction({
  name: "regenerateReelShot",
  input: RegenerateReelShotInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => regenerateReelShotService(ctx, input),
});

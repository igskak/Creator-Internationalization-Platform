"use server";

import {
  AssignArmInput,
  assignExperimentArm,
  SetExperimentStatusInput,
  setExperimentStatus,
  UpsertExperimentInput,
  upsertExperiment,
} from "@rc/modules/analytics";
import { defineAction } from "./_define";

// Experiments-lite (M7-06, plan 05 §5.10 upsertExperiment / setExperimentStatus) and the arm of a
// draft on the review screen. Owners and editors.

export const upsertExperimentAction = defineAction({
  name: "upsertExperiment",
  input: UpsertExperimentInput,
  roles: ["owner", "editor"],
  handler: async (ctx, input) => {
    const row = await upsertExperiment(ctx, input);
    return { id: row.id };
  },
});

export const setExperimentStatusAction = defineAction({
  name: "setExperimentStatus",
  input: SetExperimentStatusInput,
  roles: ["owner", "editor"],
  handler: async (ctx, input) => {
    const row = await setExperimentStatus(ctx, input);
    return { id: row.id, status: row.status };
  },
});

export const assignExperimentArmAction = defineAction({
  name: "assignExperimentArm",
  input: AssignArmInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => assignExperimentArm(ctx, input),
});

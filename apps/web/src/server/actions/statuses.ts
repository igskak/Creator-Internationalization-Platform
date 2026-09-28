"use server";

import { getStatuses as readStatuses, StatusesInput } from "@rc/modules/core";
import { defineAction } from "./_define";

/** 05 §5.7 getStatuses: polled by pages while an item is in progress. */
export const getStatuses = defineAction({
  name: "getStatuses",
  input: StatusesInput,
  handler: (ctx, input) => readStatuses(ctx, input),
});

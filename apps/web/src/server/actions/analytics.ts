"use server";

import { RequestMetricsInput, requestMetricsNow } from "@rc/modules/analytics";
import { defineAction } from "./_define";

// Plan 05 §5.9 collectMetricsNow (M6-03). Asks Instagram for the numbers of one published post now:
// the answer is a manual snapshot (J11, slot MANUAL). It costs two Insights calls, so only owners
// and editors may start it.
export const collectMetricsNow = defineAction({
  name: "collectMetricsNow",
  input: RequestMetricsInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => requestMetricsNow(ctx, input),
});

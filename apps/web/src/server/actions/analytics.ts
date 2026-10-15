"use server";

import {
  CreateAttributionImportInput,
  createAttributionImport,
  DeleteAttributionInput,
  deleteAttributionEvent,
  ReassignCampaignInput,
  RecordAttributionInput,
  RequestMetricsInput,
  reassignCampaign,
  recordAttributionEvent,
  requestMetricsNow,
} from "@rc/modules/analytics";
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

// Leads and sales (M6-08, plan 11 §11.7): typed in, imported from a CSV (J18), reconciled.
export const recordAttributionEventAction = defineAction({
  name: "recordAttributionEvent",
  input: RecordAttributionInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => recordAttributionEvent(ctx, input),
});

export const importAttributionCsvAction = defineAction({
  name: "importAttributionCsv",
  input: CreateAttributionImportInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => createAttributionImport(ctx, input),
});

export const reassignCampaignAction = defineAction({
  name: "reassignCampaign",
  input: ReassignCampaignInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => reassignCampaign(ctx, input),
});

export const deleteAttributionEventAction = defineAction({
  name: "deleteAttributionEvent",
  input: DeleteAttributionInput,
  roles: ["owner"],
  handler: (ctx, input) => deleteAttributionEvent(ctx, input),
});

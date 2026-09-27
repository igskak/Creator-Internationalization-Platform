import { type RightsDefaults, type RightsPolicy, SOURCE_TYPES } from "../json/rights";

// Every permission starts UNKNOWN: the rights gate (plan 12 §12.4) blocks AI processing until the
// owner confirms the rights matrix (Track B B-04) in the app.
const unknownPolicy: RightsPolicy = {
  use: "UNKNOWN",
  translate: "UNKNOWN",
  adapt: "UNKNOWN",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "UNKNOWN",
  improvePrompts: "UNKNOWN",
};

export const rightsDefaults = Object.fromEntries(
  SOURCE_TYPES.map((type) => [type, unknownPolicy]),
) as RightsDefaults;

export const settingSeeds: { key: string; value: unknown }[] = [
  { key: "publishing.enabled", value: false },
  { key: "publishing.min_gap_minutes", value: 180 },
  { key: "analytics.min_sample", value: 3 },
  { key: "rights.defaults", value: rightsDefaults },
];

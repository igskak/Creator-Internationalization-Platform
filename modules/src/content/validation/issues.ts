import type { VariantFlag } from "@rc/db/json";
import type { ValidationIssue } from "./types";

/** BLOCKER issues stop the pipeline step (repair once, then GENERATION_FAILED); others are notes. */
export const isBlocking = (issue: ValidationIssue) => issue.severity === "BLOCKER";

export function splitIssues(issues: readonly ValidationIssue[]) {
  return {
    blocking: issues.filter(isBlocking),
    nonBlocking: issues.filter((i) => !isBlocking(i)),
  };
}

/** Which variant flag an issue code raises when it is left after repair (04 §4.4 VariantFlag). */
const FLAG_BY_CODE: Record<string, VariantFlag> = {
  NUMERIC_MISMATCH: "NUMERIC_MISMATCH",
  FACTUAL_SLIDE_UNCITED: "UNSUPPORTED_CLAIM",
  CITATION_NOT_IN_IDEA: "UNSUPPORTED_CLAIM",
  CLAIM_UNCITED: "UNSUPPORTED_CLAIM",
  CHEF_ATTRIBUTION_UNCITED: "UNSUPPORTED_CLAIM",
  SLOT_OVERFLOW: "TEXT_OVERFLOW",
  SLOT_LINES: "TEXT_OVERFLOW",
};

export function flagsForIssues(issues: readonly ValidationIssue[]): VariantFlag[] {
  const flags = new Set<VariantFlag>();
  for (const issue of issues) {
    const flag = FLAG_BY_CODE[issue.code];
    if (flag) flags.add(flag);
  }
  return [...flags];
}

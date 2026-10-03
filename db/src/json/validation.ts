import { z } from "zod";

// Deterministic validation results (plan 04 §4.4, 07 §7.8), shared by every stage's validators.

export const ISSUE_SEVERITIES = ["BLOCKER", "MAJOR", "MINOR"] as const;

export const ValidationIssue = z.object({
  code: z.string().min(1),
  severity: z.enum(ISSUE_SEVERITIES),
  fieldPath: z.string().optional(),
  message: z.string().min(1),
  fixHint: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

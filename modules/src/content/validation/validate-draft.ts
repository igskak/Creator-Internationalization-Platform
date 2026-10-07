import { validateCitations } from "./citations";
import { validateForbiddenPatterns } from "./forbidden";
import { flagsForIssues, splitIssues } from "./issues";
import { validateNumericFidelity } from "./numeric";
import { validateSlots } from "./slots";
import { validateStructure } from "./structure";
import { validateTextRules } from "./text-rules";
import type { DraftContent, ValidationContext, ValidationIssue, Validator } from "./types";

/** In the order a reader would fix them: shape first, then facts, then wording. */
export const VALIDATORS: readonly Validator[] = [
  validateStructure,
  validateSlots,
  validateCitations,
  validateNumericFidelity,
  validateForbiddenPatterns,
  validateTextRules,
];

export type DraftValidation = {
  issues: ValidationIssue[];
  blocking: ValidationIssue[];
  nonBlocking: ValidationIssue[];
  /** Flags for what is left unresolved; see `flagsForIssues`. */
  flags: ReturnType<typeof flagsForIssues>;
};

export function validateDraft(draft: DraftContent, context: ValidationContext): DraftValidation {
  const issues = VALIDATORS.flatMap((validator) => validator(draft, context));
  return { issues, ...splitIssues(issues), flags: flagsForIssues(issues) };
}

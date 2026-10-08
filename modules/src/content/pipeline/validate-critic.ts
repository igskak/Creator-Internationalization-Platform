import type { ValidationIssue } from "@rc/db/json";
import type { contentWriter, critic } from "@rc/prompts";

// Checks of the critic's answer itself (plan 07 §7.8): scores in range, a verdict that carries
// what it needs, and field paths that exist in the draft. BLOCKER issues go to the one repair.

type Output = critic.CriticOutput;

/** Every path the critic may point at: the ones printed in its input. */
export function draftFieldPaths(draft: contentWriter.ContentWriterOutput): Set<string> {
  const paths = new Set<string>(["hook", "caption", "cta"]);
  draft.slides.forEach((slide, i) => {
    paths.add(`slides.${i}`);
    paths.add(`slides.${i}.altText`);
    for (const { slot } of slide.slots) paths.add(`slides.${i}.slots.${slot}`);
  });
  for (let i = 0; i < draft.hashtags.length; i++) paths.add(`hashtags.${i}`);
  for (let i = 0; i < draft.claimsUsed.length; i++) paths.add(`claimsUsed.${i}`);
  return paths;
}

const issue = (
  severity: ValidationIssue["severity"],
  code: string,
  fieldPath: string,
  message: string,
  fixHint: string,
): ValidationIssue => ({ severity, code, fieldPath, message, fixHint });

export function validateCriticOutput(
  output: Output,
  draft: contentWriter.ContentWriterOutput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [name, value] of Object.entries(output.scores)) {
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      issues.push(
        issue(
          "BLOCKER",
          "SCORE_OUT_OF_RANGE",
          `scores.${name}`,
          `The score ${name} is ${value}, it must be 1–5.`,
          "Give every score as a whole number from 1 to 5.",
        ),
      );
    }
  }
  if (output.verdict === "REQUEST_REWRITE" && !output.rewriteInstructions.trim()) {
    issues.push(
      issue(
        "BLOCKER",
        "REWRITE_WITHOUT_INSTRUCTIONS",
        "rewriteInstructions",
        "The verdict is REQUEST_REWRITE but there are no rewrite instructions.",
        "Say which field paths to change and how.",
      ),
    );
  }
  if (output.verdict === "FLAG_FOR_HUMAN" && !output.humanAttention.trim()) {
    issues.push(
      issue(
        "BLOCKER",
        "FLAG_WITHOUT_ATTENTION",
        "humanAttention",
        "The verdict is FLAG_FOR_HUMAN but humanAttention is empty.",
        "Say what the person must look at.",
      ),
    );
  }
  if (output.verdict === "PASS" && output.unsupportedClaims.length > 0) {
    issues.push(
      issue(
        "MAJOR",
        "PASS_WITH_UNSUPPORTED_CLAIMS",
        "verdict",
        "The verdict is PASS but unsupported claims are listed.",
        "Use REQUEST_REWRITE when a claim is unsupported.",
      ),
    );
  }
  const paths = draftFieldPaths(draft);
  output.unsupportedClaims.forEach((claim, i) => {
    if (!paths.has(claim.fieldPath)) {
      issues.push(
        issue(
          "BLOCKER",
          "FIELD_PATH_UNKNOWN",
          `unsupportedClaims.${i}.fieldPath`,
          `"${claim.fieldPath}" is not a field of the draft.`,
          "Use a path printed in the draft, for example slides.2.slots.body.",
        ),
      );
    }
  });
  output.issues.forEach((found, i) => {
    if (found.fieldPath !== "" && !paths.has(found.fieldPath)) {
      issues.push(
        issue(
          "MINOR",
          "FIELD_PATH_UNKNOWN",
          `issues.${i}.fieldPath`,
          `"${found.fieldPath}" is not a field of the draft.`,
          "Use a path printed in the draft, or an empty string for the whole draft.",
        ),
      );
    }
  });
  return issues;
}

import type { ValidationIssue, Validator } from "./types";
import { textFields } from "./types";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Market forbidden patterns (`markets.forbidden_patterns`): phrases as whole words, regexes as given. */
export const validateForbiddenPatterns: Validator = (draft, context) => {
  const issues: ValidationIssue[] = [];
  const compiled = context.forbiddenPatterns.flatMap((p) => {
    try {
      const source =
        p.kind === "REGEX"
          ? p.pattern
          : `(?<![\\p{L}\\p{N}])${escapeRegExp(p.pattern.normalize("NFC"))}(?![\\p{L}\\p{N}])`;
      return [{ pattern: p, regex: new RegExp(source, "iu") }];
    } catch {
      return [];
    }
  });
  for (const field of [
    ...textFields(draft),
    ...draft.hashtags.map((h, i) => ({ fieldPath: `hashtags.${i}`, text: h })),
  ]) {
    const text = field.text.normalize("NFC");
    for (const { pattern, regex } of compiled) {
      const match = regex.exec(text);
      if (!match) continue;
      issues.push({
        code: "FORBIDDEN_PATTERN",
        severity: "BLOCKER",
        fieldPath: field.fieldPath,
        message: `"${match[0]}" is not allowed for this market: ${pattern.reason}.`,
        fixHint: `Rephrase without "${match[0]}".`,
      });
    }
  }
  return issues;
};

import type { CtaSpec, ForbiddenPattern, Slide, ValidationIssue } from "@rc/db/json";
import type { TemplateRegistry } from "@rc/templates";
import type { NumberLocale, NumericReference } from "../../localization";

// Domain validators for generated content (plan 07 §7.8, layer 3). Pure functions: a draft and a
// context in, `ValidationIssue[]` out. BLOCKER issues are "blocking" (repair, then
// GENERATION_FAILED); MAJOR and MINOR ones become flags or notes for the reviewer.

export type { ValidationIssue };

/** A generated variant in its stored shape (slots as a record, as in `content_variants`). */
export type DraftContent = {
  hook: string;
  hookType?: string;
  caption: string;
  cta: CtaSpec;
  hashtags: readonly string[];
  slides: readonly Slide[];
  /** Writer's list of factual statements with their cards. */
  claimsUsed?: readonly { text: string; knowledgeIds: readonly string[] }[];
};

export type ValidationContext = {
  /** Language of the generated text: decimal comma for es-ES, point for en. */
  locale: NumberLocale;
  /** `markets.forbidden_patterns`. */
  forbiddenPatterns: readonly ForbiddenPattern[];
  /** Cards linked to the Master Idea (PRIMARY and SUPPORTING). */
  ideaKnowledgeIds: ReadonlySet<string>;
  /** Numbers of the cited cards, for numeric fidelity. */
  numericReference: NumericReference;
  templates?: Pick<TemplateRegistry, "get">;
};

export type Validator = (draft: DraftContent, context: ValidationContext) => ValidationIssue[];

/** Every text the reader sees, with its field path (04 §4.4 FieldPath grammar). */
export function textFields(draft: DraftContent): { fieldPath: string; text: string }[] {
  const fields = [
    { fieldPath: "hook", text: draft.hook },
    ...draft.slides.flatMap((slide) =>
      Object.entries(slide.slots).map(([slot, text]) => ({
        fieldPath: `slides.${slide.id}.slots.${slot}`,
        text,
      })),
    ),
    { fieldPath: "caption", text: draft.caption },
    { fieldPath: "cta", text: draft.cta.text },
  ];
  return fields;
}

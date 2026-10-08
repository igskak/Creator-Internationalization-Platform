import type { MarketBrief, Slide, ValidationIssue } from "@rc/db/json";
import type { contentWriter } from "@rc/prompts";
import { type DraftContent, type ValidationContext, validateDraft } from "../validation";

// The content writer's answer as a stored draft, and its checks (plan 07 §7.8, M2-10). The model
// returns slots as `{ slot, text }[]` and no slide ids; code adds ids and turns it into the
// `DraftContent` the validators of M2-05 take.

type Output = contentWriter.ContentWriterOutput;

/** `s1`, `s2` … — ids for validation only; M2-13 gives stored slides their own stable ids. */
const validationId = (index: number) => `s${index + 1}`;

export function toDraftContent(
  output: Output,
  slideId: (index: number) => string = validationId,
): DraftContent {
  const slides: Slide[] = output.slides.map((slide, index) => ({
    id: slideId(index),
    index,
    role: slide.role,
    templateId: slide.templateId,
    slots: Object.fromEntries(slide.slots.map((s) => [s.slot, s.text])),
    images: {},
    knowledgeIds: slide.knowledgeIds,
    factual: slide.factual,
    ...(slide.altText.trim() ? { altText: slide.altText } : {}),
  }));
  return {
    hook: output.hook,
    hookType: output.hookType,
    caption: output.caption,
    cta: {
      type: output.cta.type,
      text: output.cta.text,
      ...(output.cta.keyword ? { keyword: output.cta.keyword } : {}),
    },
    hashtags: output.hashtags,
    slides,
    claimsUsed: output.claimsUsed,
  };
}

/** `slides.s2.slots.body` → `slides.1.slots.body`: the model sees its own answer, which has no ids. */
function pathsByIndex(issue: ValidationIssue, output: Output): ValidationIssue {
  if (!issue.fieldPath) return issue;
  const match = /^slides\.([^.]+)(.*)$/.exec(issue.fieldPath);
  if (!match) return issue;
  const index = output.slides.findIndex((_, i) => validationId(i) === match[1]);
  return index < 0 ? issue : { ...issue, fieldPath: `slides.${index}${match[2]}` };
}

export type WriterValidationContext = ValidationContext & {
  /** The plan the draft follows. */
  brief: Pick<MarketBrief, "hookType" | "slidePlan" | "ctaApproach">;
};

/**
 * The validators of 07 §7.8 over the draft, plus two checks against the plan: the slides follow
 * the plan's roles and templates (MAJOR, the writer may have a reason), and the hook type is the
 * plan's (MINOR). Field paths of slides use the index of the answer, not an id.
 */
export function validateWriterOutput(
  output: Output,
  context: WriterValidationContext,
): ValidationIssue[] {
  const { issues } = validateDraft(toDraftContent(output), context);
  const { brief } = context;
  const extra: ValidationIssue[] = [];
  const planned = brief.slidePlan.map((s) => `${s.role}:${s.templateId}`);
  const written = output.slides.map((s) => `${s.role}:${s.templateId}`);
  if (planned.join(">") !== written.join(">")) {
    extra.push({
      code: "PLAN_DEVIATION",
      severity: "MAJOR",
      fieldPath: "slides",
      message: `The slides (${written.join(" > ")}) differ from the plan (${planned.join(" > ")}).`,
      fixHint: "Write one slide per entry of the slide plan, with its role and template, in order.",
    });
  }
  if (output.hookType !== brief.hookType) {
    extra.push({
      code: "HOOK_TYPE_CHANGED",
      severity: "MINOR",
      fieldPath: "hookType",
      message: `The hook type is ${output.hookType}, the plan says ${brief.hookType}.`,
      fixHint: "Keep the plan's hook type unless the hook cannot be written that way.",
    });
  }
  if (output.cta.type !== brief.ctaApproach.ctaType) {
    extra.push({
      code: "CTA_TYPE_CHANGED",
      severity: "MINOR",
      fieldPath: "cta.type",
      message: `The CTA type is ${output.cta.type}, the plan says ${brief.ctaApproach.ctaType}.`,
      fixHint: "Use the plan's CTA type.",
    });
  }
  return [...issues.map((i) => pathsByIndex(i, output)), ...extra];
}

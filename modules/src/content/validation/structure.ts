import type { ValidationIssue, Validator } from "./types";

export const MIN_SLIDES = 5;
/** Instagram allows 10 carousel items (⚠ V-05). */
export const MAX_SLIDES = 10;

/** 5–10 slides, first slide HOOK, last slide CTA unless the CTA type is NONE, unique slide ids. */
export const validateStructure: Validator = (draft) => {
  const issues: ValidationIssue[] = [];
  const { slides } = draft;
  if (slides.length < MIN_SLIDES || slides.length > MAX_SLIDES) {
    issues.push({
      code: "SLIDE_COUNT",
      severity: "BLOCKER",
      fieldPath: "slides",
      message: `The carousel has ${slides.length} slides, it needs ${MIN_SLIDES}–${MAX_SLIDES}.`,
      fixHint: `Use between ${MIN_SLIDES} and ${MAX_SLIDES} slides.`,
    });
  }
  const first = slides[0];
  if (first && first.role !== "HOOK") {
    issues.push({
      code: "FIRST_SLIDE_NOT_HOOK",
      severity: "BLOCKER",
      fieldPath: `slides.${first.id}`,
      message: `The first slide has the role ${first.role}, it must be HOOK.`,
      fixHint: "Make the first slide the hook.",
    });
  }
  const last = slides.at(-1);
  if (last && draft.cta.type !== "NONE" && last.role !== "CTA") {
    issues.push({
      code: "LAST_SLIDE_NOT_CTA",
      severity: "BLOCKER",
      fieldPath: `slides.${last.id}`,
      message: `The last slide has the role ${last.role}, but the CTA type is ${draft.cta.type}.`,
      fixHint: "End with a CTA slide, or set the CTA type to NONE.",
    });
  }
  const seen = new Set<string>();
  for (const slide of slides) {
    if (seen.has(slide.id)) {
      issues.push({
        code: "DUPLICATE_SLIDE_ID",
        severity: "BLOCKER",
        fieldPath: `slides.${slide.id}`,
        message: `The slide id "${slide.id}" is used twice.`,
        fixHint: "Give every slide its own id.",
      });
    }
    seen.add(slide.id);
  }
  if (!draft.hook.trim()) {
    issues.push({
      code: "HOOK_EMPTY",
      severity: "BLOCKER",
      fieldPath: "hook",
      message: "The hook is empty.",
      fixHint: "Write the hook line.",
    });
  }
  if (!draft.caption.trim()) {
    issues.push({
      code: "CAPTION_EMPTY",
      severity: "BLOCKER",
      fieldPath: "caption",
      message: "The caption is empty.",
      fixHint: "Write the caption.",
    });
  }
  return issues;
};

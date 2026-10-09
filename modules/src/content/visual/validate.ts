import type { Slide, ValidationIssue, VisualBrief } from "@rc/db/json";
import type { TemplateRegistry } from "@rc/templates";

// Checks of the visual director's brief (plan 07 §7.6.1 "Visual direction", M3-02): every
// required image slot is covered, library ids exist and are allowed, prompts exist for generated
// pictures, the style and the hypothesis are real. BLOCKER issues go to the one repair.

export type VisualValidationContext = {
  /** The slides of the draft, with their template ids. */
  slides: readonly Pick<Slide, "id" | "templateId">[];
  templates: Pick<TemplateRegistry, "get">;
  /** Ids of the library photos that were offered (their rights allow a visual transform). */
  libraryIds: ReadonlySet<string>;
  /** Codes of `taxonomy_terms` visual_style. */
  visualStyles: ReadonlySet<string>;
  /** Ids of the market's visual hypotheses that were offered. */
  hypothesisIds: ReadonlySet<string>;
};

const issue = (
  severity: ValidationIssue["severity"],
  code: string,
  fieldPath: string,
  message: string,
  fixHint: string,
): ValidationIssue => ({ code, severity, fieldPath, message, fixHint });

/** A picture that asks for lettering, a logo or a pack is one the templates cannot use. */
const TEXT_IN_PICTURE = /\b(text|lettering|typography|logo|watermark|label|packaging)\b/i;

export function validateVisualBrief(
  brief: VisualBrief,
  context: VisualValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const slideById = new Map(context.slides.map((s) => [s.id, s]));
  const seen = new Set<string>();

  if (!context.visualStyles.has(brief.visualStyle)) {
    issues.push(
      issue(
        "BLOCKER",
        "VISUAL_STYLE_UNKNOWN",
        "visualStyle",
        `"${brief.visualStyle}" is not a visual style.`,
        "Use a code from <visual_styles>.",
      ),
    );
  }
  if (brief.hypothesisId && !context.hypothesisIds.has(brief.hypothesisId)) {
    issues.push(
      issue(
        "BLOCKER",
        "VISUAL_HYPOTHESIS_UNKNOWN",
        "hypothesisId",
        `"${brief.hypothesisId}" is not a hypothesis of the market.`,
        "Use an id from <market>, or leave hypothesisId out.",
      ),
    );
  }

  brief.slides.forEach((entry, i) => {
    const path = `slides.${i}`;
    const key = `${entry.slideId}/${entry.slot}`;
    const slide = slideById.get(entry.slideId);
    const spec = slide
      ? context.templates.get(slide.templateId)?.imageSlots[entry.slot]
      : undefined;
    if (!slide) {
      issues.push(
        issue(
          "BLOCKER",
          "VISUAL_SLIDE_UNKNOWN",
          `${path}.slideId`,
          `"${entry.slideId}" is not a slide of the draft.`,
          "Use the slide ids given in <slides>.",
        ),
      );
    } else if (!spec) {
      issues.push(
        issue(
          "BLOCKER",
          "VISUAL_SLOT_UNKNOWN",
          `${path}.slot`,
          `Template ${slide.templateId} has no image slot "${entry.slot}".`,
          "Use only the image_slot names of the slide.",
        ),
      );
    } else if (spec.aspect !== "8:5" && spec.aspect !== entry.aspect) {
      issues.push(
        issue(
          "MINOR",
          "VISUAL_ASPECT",
          `${path}.aspect`,
          `The slot is ${spec.aspect}, the brief says ${entry.aspect}.`,
          `Use ${spec.aspect}.`,
        ),
      );
    }
    if (seen.has(key)) {
      issues.push(
        issue(
          "BLOCKER",
          "VISUAL_SLOT_DUPLICATE",
          path,
          `The slot ${key} is planned twice.`,
          "Plan every image slot once.",
        ),
      );
    }
    seen.add(key);

    if (entry.source === "GENERATE") {
      if (!entry.prompt?.trim()) {
        issues.push(
          issue(
            "BLOCKER",
            "VISUAL_PROMPT_MISSING",
            `${path}.prompt`,
            "A generated picture needs a prompt.",
            "Describe the picture in the prompt.",
          ),
        );
      } else if (TEXT_IN_PICTURE.test(entry.prompt)) {
        issues.push(
          issue(
            "MAJOR",
            "VISUAL_PROMPT_TEXT",
            `${path}.prompt`,
            "The prompt mentions text, a logo or packaging.",
            "Describe only the food and the scene; the text goes in the template.",
          ),
        );
      }
    }
    if (entry.source === "LIBRARY") {
      if (!entry.libraryAssetId || !context.libraryIds.has(entry.libraryAssetId)) {
        issues.push(
          issue(
            "BLOCKER",
            "VISUAL_LIBRARY_UNKNOWN",
            `${path}.libraryAssetId`,
            `"${entry.libraryAssetId ?? ""}" is not a photo of <library>.`,
            "Pick a photo listed in <library>, or generate the picture.",
          ),
        );
      }
    }
  });

  // Every required slot of every slide needs a picture.
  for (const slide of context.slides) {
    const template = context.templates.get(slide.templateId);
    for (const [name, spec] of Object.entries(template?.imageSlots ?? {})) {
      if (!spec.required) continue;
      const entry = brief.slides.find((e) => e.slideId === slide.id && e.slot === name);
      if (!entry || entry.source === "NONE") {
        issues.push(
          issue(
            "BLOCKER",
            "VISUAL_SLOT_UNCOVERED",
            `slides.${slide.id}.images.${name}`,
            `The required image slot ${name} of slide ${slide.id} has no picture.`,
            "Plan a generated or library picture for it.",
          ),
        );
      }
    }
  }
  return issues;
}

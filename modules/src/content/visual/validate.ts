import type { Slide, ValidationIssue, VisualBrief } from "@rc/db/json";
import { countChars, stripEmphasis, type TemplateRegistry } from "@rc/templates";

// Checks of the visual director's brief (plan 07 §7.6.1 "Visual direction", M3-02): every
// required image slot is covered, library ids exist and are allowed, prompts exist for generated
// pictures, the style and the hypothesis are real, and (visual-director@4 on) the shot list
// varies. BLOCKER issues go to the one repair.

export type VisualValidationContext = {
  /** The slides of the draft, with their template ids and roles. */
  slides: readonly Pick<Slide, "id" | "templateId" | "role" | "slots">[];
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

  issues.push(...shotListIssues(brief, context));
  issues.push(...colourIssues(brief, context));
  issues.push(...placementIssues(brief, context));

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

/** At most this many pictures of the food in its pot or pan per carousel. */
export const MAX_VESSEL_SHOTS = 2;
/** From this many generated pictures on, the shot list uses at least `MIN_SHOT_KINDS` kinds. */
export const VARIED_FROM = 4;
export const MIN_SHOT_KINDS = 3;

/**
 * The variety of the shot list (visual-director@4): no two slides in a row with the same kind of
 * shot, few pictures of food in its pot, several kinds of shot. Briefs without shot types (older
 * versions) are not checked.
 */
function shotListIssues(brief: VisualBrief, context: VisualValidationContext): ValidationIssue[] {
  const order = new Map(context.slides.map((s, i) => [s.id, i]));
  const shots = brief.slides
    .map((entry, i) => ({ entry, path: `slides.${i}.shotType` }))
    .filter(
      ({ entry }) => entry.source === "GENERATE" && entry.shotType && order.has(entry.slideId),
    )
    .sort((a, b) => (order.get(a.entry.slideId) ?? 0) - (order.get(b.entry.slideId) ?? 0));
  if (shots.length === 0) return [];
  const issues: ValidationIssue[] = [];
  shots.forEach((shot, i) => {
    const previous = shots[i - 1];
    const sameSlide = previous?.entry.slideId === shot.entry.slideId;
    if (previous && !sameSlide && previous.entry.shotType === shot.entry.shotType) {
      issues.push(
        issue(
          "BLOCKER",
          "VISUAL_SHOT_REPEATED",
          shot.path,
          `Slides ${previous.entry.slideId} and ${shot.entry.slideId} follow each other with the same shot (${shot.entry.shotType}).`,
          "Give neighbouring slides different kinds of shot.",
        ),
      );
    }
  });
  const vessel = shots.filter((s) => s.entry.shotType === "IN_THE_VESSEL");
  if (vessel.length > MAX_VESSEL_SHOTS) {
    issues.push(
      issue(
        "BLOCKER",
        "VISUAL_SHOT_VESSEL",
        vessel[MAX_VESSEL_SHOTS]?.path ?? "slides",
        `${vessel.length} pictures show the food in its pot or pan; at most ${MAX_VESSEL_SHOTS}.`,
        "Show the ingredient close up, the technique in action, a comparison or the tool instead.",
      ),
    );
  }
  const kinds = new Set(shots.map((s) => s.entry.shotType));
  if (shots.length >= VARIED_FROM && kinds.size < MIN_SHOT_KINDS) {
    issues.push(
      issue(
        "BLOCKER",
        "VISUAL_SHOT_MONOTONOUS",
        "slides",
        `${shots.length} pictures use only ${kinds.size} kind(s) of shot.`,
        `Use at least ${MIN_SHOT_KINDS} kinds of shot in the carousel.`,
      ),
    );
  }
  return issues;
}

/**
 * Colour (visual-director@5): at least half of the generated pictures carry a colour accent, and a
 * serving suggestion the recipe does not name appears only on the cover or a finished dish. Briefs
 * without colour fields (older versions) are not checked.
 */
function colourIssues(brief: VisualBrief, context: VisualValidationContext): ValidationIssue[] {
  const generated = brief.slides
    .map((entry, i) => ({ entry, path: `slides.${i}` }))
    .filter(({ entry }) => entry.source === "GENERATE");
  if (!generated.some(({ entry }) => entry.colorAccent !== undefined)) return [];
  const issues: ValidationIssue[] = [];
  const coloured = generated.filter(({ entry }) => entry.colorAccent?.trim());
  const needed = Math.ceil(generated.length / 2);
  if (coloured.length < needed) {
    issues.push(
      issue(
        "BLOCKER",
        "VISUAL_COLOUR_MISSING",
        "slides",
        `${coloured.length} of ${generated.length} pictures have a colour accent; at least ${needed} need one.`,
        "Give more pictures a colour accent from the recipe, or a colourful vessel for pale food.",
      ),
    );
  }
  const roleOf = new Map(context.slides.map((s) => [s.id, s.role]));
  for (const { entry, path } of coloured) {
    if (!entry.colorSource) {
      issues.push(
        issue(
          "MINOR",
          "VISUAL_COLOUR_SOURCE",
          `${path}.colorSource`,
          "A colour accent without its source.",
          "Say RECIPE or SERVING.",
        ),
      );
    } else if (
      entry.colorSource === "SERVING" &&
      entry.shotType !== "FINISHED_DISH" &&
      roleOf.get(entry.slideId) !== "HOOK"
    ) {
      issues.push(
        issue(
          "BLOCKER",
          "VISUAL_COLOUR_SERVING",
          `${path}.colorSource`,
          `A serving suggestion (${entry.colorAccent}) on a ${entry.shotType ?? "step"} picture would look like a step of the recipe.`,
          "Use a serving suggestion only on the cover or a FINISHED_DISH shot; elsewhere take the colour from the recipe or the vessel.",
        ),
      );
    }
  }
  return issues;
}

/** Slots that are short by nature and do not count against a bottom band. */
const HEADING_SLOTS = new Set(["headline", "title", "number", "label", "kicker", "offerName"]);
/** A picture across the bottom leaves room for this much text besides the headline. */
export const BOTTOM_BAND_MAX_CHARS = 140;

/**
 * Placement (visual-director@6): two inner slides in a row never share a placement, and a bottom
 * band only goes on a slide with little text. Briefs without placements are not checked.
 */
function placementIssues(brief: VisualBrief, context: VisualValidationContext): ValidationIssue[] {
  const order = new Map(context.slides.map((s, i) => [s.id, i]));
  const slideById = new Map(context.slides.map((s) => [s.id, s]));
  const placed = brief.slides
    .map((entry, i) => ({ entry, path: `slides.${i}.placement` }))
    .filter(
      ({ entry }) => entry.source === "GENERATE" && entry.placement && order.has(entry.slideId),
    )
    .sort((a, b) => (order.get(a.entry.slideId) ?? 0) - (order.get(b.entry.slideId) ?? 0));
  const issues: ValidationIssue[] = [];
  placed.forEach(({ entry, path }, i) => {
    const previous = placed[i - 1]?.entry;
    if (
      previous &&
      previous.slideId !== entry.slideId &&
      previous.placement === entry.placement &&
      (order.get(entry.slideId) ?? 0) - (order.get(previous.slideId) ?? 0) === 1
    ) {
      issues.push(
        issue(
          "BLOCKER",
          "VISUAL_PLACEMENT_REPEATED",
          path,
          `Slides ${previous.slideId} and ${entry.slideId} follow each other with the picture in the same place (${entry.placement}).`,
          "Move the picture of one of them: CORNER, TOP_RIGHT, RIGHT_COLUMN or BOTTOM_BAND.",
        ),
      );
    }
    if (entry.placement === "BOTTOM_BAND") {
      const slide = slideById.get(entry.slideId);
      const chars = Object.entries(slide?.slots ?? {})
        .filter(([name]) => !HEADING_SLOTS.has(name))
        .reduce((sum, [, text]) => sum + countChars(stripEmphasis(text)), 0);
      if (chars > BOTTOM_BAND_MAX_CHARS) {
        issues.push(
          issue(
            "BLOCKER",
            "VISUAL_PLACEMENT_BAND",
            path,
            `Slide ${entry.slideId} has ${chars} characters of text besides the headline; a bottom band leaves room for ${BOTTOM_BAND_MAX_CHARS}.`,
            "Use CORNER, TOP_RIGHT or RIGHT_COLUMN for a slide with more text.",
          ),
        );
      }
    }
  });
  return issues;
}

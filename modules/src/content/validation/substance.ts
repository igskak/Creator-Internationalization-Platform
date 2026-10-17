import { countChars, stripEmphasis } from "@rc/templates";
import type { ValidationIssue, Validator } from "./types";

// Substance of the text (carousel v3, docs/design/carousel-v3-requirements.md T2): the live
// English carousels carried lines that told the reader nothing ("breathe, there's a calm fix") and
// inner slides of one or two lines. Filler is a MAJOR issue the reviewer sees; a thin inner slide
// and a step without any number are MINOR notes only, because the closed book wins: a card
// without a number for a step must not push the writer to invent one (numeric fidelity blocks an
// invented number anyway).

/** Lines that carry no information, per language; matched as whole words, any case. */
export const FILLER_PHRASES: Readonly<Record<string, readonly string[]>> = {
  en: [
    "breathe",
    "don't panic",
    "calm fix",
    "it happens to everyone",
    "here's the thing",
    "the secret is simple",
    "trust the process",
    "game changer",
    "game-changer",
  ],
  "es-ES": [
    "respira",
    "no entres en pánico",
    "que no cunda el pánico",
    "le pasa a todo el mundo",
    "el secreto es sencillo",
    "confía en el proceso",
    "cambia las reglas del juego",
  ],
};

/** Slots that head a slide; the rest is its text. */
const HEADING_SLOTS = new Set([
  "headline",
  "title",
  "number",
  "label",
  "kicker",
  "offerName",
  "lead",
  "closer",
  "keyword",
  "beforeLabel",
  "afterLabel",
  "mistakeTitle",
  "correctTitle",
]);
/** An inner slide whose text fills less than this share of its slots is thin. */
export const THIN_SHARE = 0.3;
const INNER_EXEMPT = new Set(["HOOK", "CTA"]);
const DIGIT_OR_FRACTION = /[\p{Nd}½¼¾⅓⅔]/u;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const validateSubstance: Validator = (draft, context) => {
  const issues: ValidationIssue[] = [];
  const phrases = FILLER_PHRASES[context.locale] ?? [];
  const filler = phrases.length
    ? new RegExp(`(?<![\\p{L}])(?:${phrases.map(escapeRegExp).join("|")})(?![\\p{L}])`, "iu")
    : null;

  const fields = [
    ...draft.slides.flatMap((slide) =>
      Object.entries(slide.slots).map(([slot, text]) => ({
        fieldPath: `slides.${slide.id}.slots.${slot}`,
        text: stripEmphasis(text).replaceAll("’", "'"),
      })),
    ),
    { fieldPath: "caption", text: draft.caption.replaceAll("’", "'") },
  ];
  if (filler) {
    for (const field of fields) {
      const found = filler.exec(field.text);
      if (!found) continue;
      issues.push({
        code: "FILLER_PHRASE",
        severity: "MAJOR",
        fieldPath: field.fieldPath,
        message: `"${found[0]}" tells the reader nothing.`,
        fixHint:
          "Replace it with a fact of the cards: an amount, a time, a cue the reader can see.",
      });
    }
  }

  const { templates } = context;
  if (!templates) return issues;
  for (const slide of draft.slides) {
    if (INNER_EXEMPT.has(slide.role)) continue;
    const spec = templates.get(slide.templateId);
    if (!spec) continue;
    let used = 0;
    let room = 0;
    for (const [name, limits] of Object.entries(spec.textSlots)) {
      if (HEADING_SLOTS.has(name)) continue;
      room += limits.maxChars;
      used += countChars(stripEmphasis(slide.slots[name] ?? ""));
    }
    if (room > 0 && used < room * THIN_SHARE) {
      issues.push({
        code: "THIN_SLIDE",
        severity: "MINOR",
        fieldPath: `slides.${slide.id}`,
        message: `The slide uses ${used} of ${room} characters of text.`,
        fixHint:
          "Tell the step in full from the cards: what to do, in what order, the numbers and how it looks when it works.",
      });
    }
    if (slide.role === "STEP") {
      const text = Object.values(slide.slots).map(stripEmphasis).join(" ");
      if (!DIGIT_OR_FRACTION.test(text)) {
        issues.push({
          code: "STEP_WITHOUT_NUMBER",
          severity: "MINOR",
          fieldPath: `slides.${slide.id}`,
          message: "The step gives no amount, time or temperature.",
          fixHint: "Add the step's number from the cards, if the cards give one.",
        });
      }
    }
  }
  return issues;
};

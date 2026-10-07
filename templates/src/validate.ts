import type { TemplateDefinition, TextSlotSpec } from "./define-template";
import { registry, type TemplateRegistry } from "./registry";

// Slot-limit checks against the template metadata (plan 07 §7.8 layer 3, first bullet). The result
// is shaped like db `ValidationIssue` (templates cannot import db); M2-05 maps severities to flags.

export type TemplateIssue = {
  code: string;
  severity: "BLOCKER" | "MAJOR" | "MINOR";
  fieldPath: string;
  message: string;
  fixHint?: string;
};

/** The parts of a `Slide` this check reads. */
export type SlideForValidation = {
  id: string;
  role: string;
  templateId: string;
  slots: Readonly<Record<string, string>>;
  images?: Readonly<Record<string, unknown>>;
};

/**
 * A line holds about `maxChars / maxLines` characters at the smallest font; proportional fonts and
 * word breaks fit a bit more or less. Starting value, tune with the first real renders (M3-08/09).
 */
export const LINE_FILL_FACTOR = 1.1;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Visible characters: NFC-normalized grapheme clusters, so "é" counts once either way. */
export function countChars(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text.normalize("NFC"))) count += 1;
  return count;
}

/** Greedy word wrap; explicit newlines start a new line; a word longer than a line spans several. */
export function estimateLines(
  text: string,
  slot: Pick<TextSlotSpec, "maxChars" | "maxLines">,
): number {
  const perLine = Math.max(1, Math.ceil((slot.maxChars / slot.maxLines) * LINE_FILL_FACTOR));
  let lines = 0;
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let used = 0;
    let paragraphLines = 1;
    for (const word of words) {
      const length = countChars(word);
      if (used === 0) {
        paragraphLines += Math.ceil(length / perLine) - 1;
        used = length % perLine || perLine;
      } else if (used + 1 + length <= perLine) {
        used += 1 + length;
      } else {
        paragraphLines += Math.ceil(length / perLine);
        used = length % perLine || perLine;
      }
    }
    lines += paragraphLines;
  }
  return lines;
}

export function validateSlideAgainstTemplate(
  slide: SlideForValidation,
  templates: Pick<TemplateRegistry, "get"> = registry,
): TemplateIssue[] {
  const base = `slides.${slide.id}`;
  const template: Readonly<TemplateDefinition> | undefined = templates.get(slide.templateId);
  if (!template) {
    return [
      {
        code: "TEMPLATE_UNKNOWN",
        severity: "BLOCKER",
        fieldPath: base,
        message: `Template "${slide.templateId}" does not exist.`,
        fixHint: "Use a template id from the catalog.",
      },
    ];
  }
  const issues: TemplateIssue[] = [];
  if (!(template.roles as readonly string[]).includes(slide.role)) {
    issues.push({
      code: "ROLE_NOT_ALLOWED",
      severity: "BLOCKER",
      fieldPath: base,
      message: `Template ${template.id} cannot carry the role ${slide.role} (allowed: ${template.roles.join(", ")}).`,
      fixHint: "Pick a template whose roles include the slide role.",
    });
  }
  for (const [name, text] of Object.entries(slide.slots)) {
    const path = `${base}.slots.${name}`;
    const spec = template.textSlots[name];
    if (!spec) {
      issues.push({
        code: "SLOT_UNKNOWN",
        severity: "BLOCKER",
        fieldPath: path,
        message: `Template ${template.id} has no text slot "${name}".`,
        fixHint: `Slots: ${Object.keys(template.textSlots).join(", ")}.`,
      });
      continue;
    }
    const chars = countChars(text);
    if (chars > spec.maxChars) {
      issues.push({
        code: "SLOT_OVERFLOW",
        severity: "BLOCKER",
        fieldPath: path,
        message: `${name} has ${chars} characters, the limit is ${spec.maxChars}.`,
        fixHint: `Shorten to at most ${spec.maxChars} characters.`,
      });
    } else if (estimateLines(text, spec) > spec.maxLines) {
      issues.push({
        code: "SLOT_LINES",
        severity: "MAJOR",
        fieldPath: path,
        message: `${name} needs about ${estimateLines(text, spec)} lines, the limit is ${spec.maxLines}.`,
        fixHint: "Use shorter words or fewer line breaks.",
      });
    }
  }
  for (const [name, spec] of Object.entries(template.textSlots)) {
    if (spec.required && !(slide.slots[name] ?? "").trim()) {
      issues.push({
        code: "SLOT_REQUIRED_MISSING",
        severity: "BLOCKER",
        fieldPath: `${base}.slots.${name}`,
        message: `Required slot "${name}" is empty.`,
        fixHint: `Fill ${name} (up to ${spec.maxChars} characters).`,
      });
    }
  }
  // Image slots are filled by the visual pipeline (M3); only unknown names are an error here.
  for (const name of Object.keys(slide.images ?? {})) {
    if (!(name in template.imageSlots)) {
      issues.push({
        code: "IMAGE_SLOT_UNKNOWN",
        severity: "BLOCKER",
        fieldPath: `${base}.images.${name}`,
        message: `Template ${template.id} has no image slot "${name}".`,
        fixHint: `Image slots: ${Object.keys(template.imageSlots).join(", ") || "none"}.`,
      });
    }
  }
  return issues;
}

// Template metadata (plan 08 §8.2). One source of truth for slot limits: the writer prompt, the
// validators and the renderer all read them from here. React components are added by M3-07+.

export const SLIDE_ROLES = [
  "HOOK",
  "PROBLEM",
  "EXPLANATION",
  "STEP",
  "MISTAKE",
  "CORRECT",
  "FACT",
  "COMPARISON",
  "SUMMARY",
  "CTA",
] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];

export const TEMPLATE_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Font family slot of the brand visual system (`brands.visual_system.fonts`). */
export type FontKind = "display" | "body";

export type TextSlotSpec = {
  maxChars: number;
  maxLines: number;
  required: boolean;
  font: FontKind;
  /** Fit-text shrinks the font from maxPx down to minPx before it reports an overflow. */
  minPx: number;
  maxPx: number;
};

/** 8:5 is a half-height slot on the 1080 × 1350 canvas (template C). */
export type ImageAspect = "4:5" | "1:1" | "8:5";

export type ImageSlotSpec = {
  aspect: ImageAspect;
  required: boolean;
  fullBleed?: boolean;
};

export type LogoAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** P0 templates render in the MVP; P1 ones are catalogued but not offered to the prompts by default. */
export type TemplatePriority = "P0" | "P1";

export type TemplateDefinition = {
  id: TemplateId;
  /** semver; part of the render input hash and of generation_config.templatesVersion. */
  version: string;
  name: string;
  priority: TemplatePriority;
  roles: readonly SlideRole[];
  textSlots: Readonly<Record<string, TextSlotSpec>>;
  imageSlots: Readonly<Record<string, ImageSlotSpec>>;
  logo: { anchor: LogoAnchor; heightPx: number };
};

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Checks the definition once at import time and freezes it. */
export function defineTemplate(definition: TemplateDefinition): Readonly<TemplateDefinition> {
  const { id } = definition;
  const fail = (message: string): never => {
    throw new Error(`Template ${id}: ${message}`);
  };
  if (!SEMVER.test(definition.version)) fail(`version "${definition.version}" is not semver`);
  if (definition.roles.length === 0) fail("needs at least one role");
  if (new Set(definition.roles).size !== definition.roles.length) fail("duplicate roles");
  const textNames = Object.keys(definition.textSlots);
  if (textNames.length === 0) fail("needs at least one text slot");
  for (const name of Object.keys(definition.imageSlots)) {
    if (name in definition.textSlots) fail(`slot "${name}" is both a text and an image slot`);
  }
  for (const [name, slot] of Object.entries(definition.textSlots)) {
    if (!Number.isInteger(slot.maxChars) || slot.maxChars <= 0) fail(`${name}: maxChars`);
    if (!Number.isInteger(slot.maxLines) || slot.maxLines <= 0) fail(`${name}: maxLines`);
    if (slot.minPx <= 0 || slot.minPx > slot.maxPx) fail(`${name}: font size range`);
  }
  return Object.freeze({
    ...definition,
    roles: Object.freeze([...definition.roles]),
    textSlots: Object.freeze({ ...definition.textSlots }),
    imageSlots: Object.freeze({ ...definition.imageSlots }),
    logo: Object.freeze({ ...definition.logo }),
  });
}

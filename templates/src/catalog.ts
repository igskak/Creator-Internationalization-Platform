import type {
  ImageSlotSpec,
  TemplateDefinition,
  TemplatePriority,
  TextSlotSpec,
} from "./define-template";
import { registry, type TemplateRegistry } from "./registry";

// Compact catalog text for the <template_catalog> section of the market adapter and writer prompts
// (plan 07 §7.3). Deterministic: same registry, same text, so prompt snapshots stay stable.

function textSlot(name: string, slot: TextSlotSpec): string {
  const lines = slot.maxLines === 1 ? "1 line" : `${slot.maxLines} lines`;
  return `${name} ≤${slot.maxChars} chars/${lines}${slot.required ? "" : " (optional)"}`;
}

function imageSlot(name: string, slot: ImageSlotSpec): string {
  return `${name} ${slot.aspect}${slot.fullBleed ? " full-bleed" : ""}${slot.required ? "" : " (optional)"}`;
}

export function describeTemplate(template: Readonly<TemplateDefinition>): string {
  const images = Object.entries(template.imageSlots).map(([n, s]) => imageSlot(n, s));
  return [
    `${template.id} "${template.name}" v${template.version}; roles: ${template.roles.join(", ")}`,
    `  text: ${Object.entries(template.textSlots)
      .map(([n, s]) => textSlot(n, s))
      .join("; ")}`,
    `  images: ${images.length > 0 ? images.join("; ") : "none"}`,
  ].join("\n");
}

/** P0 templates only by default: P1 ones are not rendered in the MVP. */
export function renderTemplateCatalog(
  options: { priority?: TemplatePriority | "ALL"; registry?: Pick<TemplateRegistry, "list"> } = {},
): string {
  const priority = options.priority ?? "P0";
  const templates = (options.registry ?? registry).list(priority === "ALL" ? {} : { priority });
  return templates.map(describeTemplate).join("\n");
}

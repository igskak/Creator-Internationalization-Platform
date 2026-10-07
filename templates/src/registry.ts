import { templateA } from "./carousel-a/meta";
import { templateB } from "./carousel-b/meta";
import { templateC } from "./carousel-c/meta";
import { templateD } from "./carousel-d/meta";
import { templateE } from "./carousel-e/meta";
import { templateF } from "./carousel-f/meta";
import type {
  SlideRole,
  TemplateDefinition,
  TemplateId,
  TemplatePriority,
} from "./define-template";

export type TemplateRegistry = {
  get(id: string): Readonly<TemplateDefinition> | undefined;
  list(filter?: { priority?: TemplatePriority }): readonly Readonly<TemplateDefinition>[];
  /** Templates that can carry a role, P0 first. */
  forRole(
    role: SlideRole,
    filter?: { priority?: TemplatePriority },
  ): readonly Readonly<TemplateDefinition>[];
  /** For `generation_config.templatesVersion`, e.g. "A@1.0.0,B@1.0.0". */
  version(filter?: { priority?: TemplatePriority }): string;
};

export function createRegistry(
  definitions: readonly Readonly<TemplateDefinition>[],
): TemplateRegistry {
  const byId = new Map<string, Readonly<TemplateDefinition>>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) throw new Error(`Duplicate template ${definition.id}`);
    byId.set(definition.id, definition);
  }
  const sorted = [...definitions].sort((a, b) => a.id.localeCompare(b.id));
  const list: TemplateRegistry["list"] = (filter) =>
    filter?.priority ? sorted.filter((t) => t.priority === filter.priority) : sorted;
  return {
    get: (id) => byId.get(id),
    list,
    forRole: (role, filter) =>
      list(filter)
        .filter((t) => t.roles.includes(role))
        .sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id)),
    version: (filter) =>
      list(filter)
        .map((t) => `${t.id}@${t.version}`)
        .join(","),
  };
}

export const ALL_TEMPLATES: readonly Readonly<TemplateDefinition>[] = [
  templateA,
  templateB,
  templateC,
  templateD,
  templateE,
  templateF,
];

export const registry: TemplateRegistry = createRegistry(ALL_TEMPLATES);

export const getTemplate = (id: TemplateId | string) => registry.get(id);

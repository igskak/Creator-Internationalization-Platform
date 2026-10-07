export const PACKAGE_NAME = "@rc/templates";

export { describeTemplate, renderTemplateCatalog } from "./catalog";
export {
  defineTemplate,
  type FontKind,
  type ImageAspect,
  type ImageSlotSpec,
  type LogoAnchor,
  SLIDE_ROLES,
  type SlideRole,
  TEMPLATE_IDS,
  type TemplateDefinition,
  type TemplateId,
  type TemplatePriority,
  type TextSlotSpec,
} from "./define-template";
export {
  ALL_TEMPLATES,
  createRegistry,
  getTemplate,
  registry,
  type TemplateRegistry,
} from "./registry";
export {
  countChars,
  estimateLines,
  LINE_FILL_FACTOR,
  type SlideForValidation,
  type TemplateIssue,
  validateSlideAgainstTemplate,
} from "./validate";

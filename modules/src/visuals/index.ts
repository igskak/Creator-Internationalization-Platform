export const MODULE_NAME = "visuals";

export {
  GenerateVisualAssetsPayload,
  type GenerateVisualAssetsResult,
  generateVisualAssets,
  promptHashOf,
  type SlotOutcome,
} from "./generate-assets";
export * from "./images";
export { getSlidePreviewHtml, SlidePreviewInput } from "./preview";
export {
  loadRenderAssets,
  loadRenderInput,
  RENDER_DEBOUNCE_SECONDS,
  RenderCarouselPayload,
  requestRender,
  templatesVersionOf,
} from "./render-input";

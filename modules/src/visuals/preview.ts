import { NotFoundError, ValidationError } from "@rc/lib/errors";
import { registry } from "@rc/templates";
import { renderSlideHtml } from "@rc/templates/render";
import { z } from "zod";
import type { ServiceContext } from "../core";
import { loadRenderAssets, loadRenderInput } from "./render-input";

// The live HTML preview of one slide (plan 08 §8.5, M3-13): the same `renderSlideHtml` the renderer
// uses, with the slot values of an unsaved draft allowed, so what is shown is what will be exported.

export const SlidePreviewInput = z.object({
  variantId: z.uuid(),
  slideId: z.string().min(1).max(100),
  /** Unsaved slot values; they replace the stored ones, slot by slot. */
  slots: z.record(z.string().max(60), z.string().max(2000)).optional(),
});
export type SlidePreviewInput = z.infer<typeof SlidePreviewInput>;

export async function getSlidePreviewHtml(
  ctx: ServiceContext,
  raw: z.input<typeof SlidePreviewInput>,
): Promise<string> {
  const parsed = SlidePreviewInput.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  const { variantId, slideId, slots } = parsed.data;

  const input = await loadRenderInput(ctx, variantId);
  const index = input.slides.findIndex((s) => s.id === slideId);
  const slide = input.slides[index];
  if (!slide) throw new NotFoundError("Slide not found.", { details: { variantId, slideId } });

  const template = registry.get(slide.templateId);
  const merged = { ...slide.slots };
  for (const [name, text] of Object.entries(slots ?? {})) {
    // Only the slots the template has: a draft cannot add markup the template does not know.
    if (template?.textSlots[name]) merged[name] = text;
  }
  const assets = (await loadRenderAssets(ctx, input))[index]?.assets;
  return renderSlideHtml({
    slide: { ...slide, slots: merged },
    theme: input.theme,
    assets: assets ?? { images: {} },
    page: { index: index + 1, count: input.slides.length },
  });
}

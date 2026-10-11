"use client";

import type { Slide } from "@rc/db/json";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { EditableText } from "./editable-text";
import { RegeneratePopover } from "./regenerate-popover";
import { RegenerationDiff } from "./regeneration-diff";
import { SlidePreview } from "./slide-preview";
import { fieldDomId, useVariant } from "./variant-state";

/**
 * The slide drawer (plan 10 §10.3): the slots of one slide with counters and limits, its pictures,
 * the cards it cites and the live preview of the saved slide.
 */
export function SlideDrawer({
  slides,
  cardTitles,
}: {
  slides: Slide[];
  cardTitles: Record<string, string>;
}) {
  const { messages } = useI18n();
  const e = messages.review.edit;
  const variant = useVariant();
  const index = slides.findIndex((s) => s.id === variant.openSlide);
  const slide = index >= 0 ? slides[index] : undefined;
  const info = slide ? variant.templates[slide.templateId] : undefined;
  const n = index + 1;

  return (
    <Sheet open={slide !== undefined} onOpenChange={(open) => !open && variant.setOpenSlide(null)}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
        {slide ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>{format(e.slide.title, { n })}</SheetTitle>
              <SheetDescription>
                {format(e.slide.description, { role: slide.role, template: slide.templateId })}
              </SheetDescription>
            </SheetHeader>

            <div className="mx-auto w-full max-w-64">
              <SlidePreview
                key={variant.lockVersion}
                variantId={variant.variantId}
                slideId={slide.id}
                title={format(e.slide.title, { n })}
                className="rounded-lg border"
              />
              <p className="mt-1 text-center text-xs text-muted-foreground">
                {e.slide.previewHint}
              </p>
            </div>

            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {e.slide.textSlots}
              </h3>
              {(info?.textSlots ?? []).map((slot) => (
                <div key={slot.name} className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] text-muted-foreground">{slot.name}</span>
                  <EditableText
                    path={`slides.${slide.id}.slots.${slot.name}`}
                    label={slot.name}
                    fieldLabel={format(e.field.slot, { slot: slot.name, n })}
                    value={slide.slots[slot.name] ?? ""}
                    maxChars={slot.maxChars}
                    maxLines={slot.maxLines}
                    required={slot.required}
                    rows={Math.min(6, slot.maxLines + 1)}
                  />
                </div>
              ))}
              {Object.keys(slide.slots)
                .filter((name) => !info?.textSlots.some((s) => s.name === name))
                .map((name) => (
                  <p key={name} className="text-sm text-muted-foreground">
                    <span className="font-mono text-[11px]">{name}</span>: {slide.slots[name]}
                  </p>
                ))}
            </section>

            {(info?.imageSlots.length ?? 0) > 0 ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {e.slide.images}
                </h3>
                {info?.imageSlots.map((name) => {
                  const path = `slides.${slide.id}.images.${name}`;
                  return (
                    <div
                      key={name}
                      id={fieldDomId(variant.variantId, path)}
                      data-field={path}
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {name}
                          </span>{" "}
                          {slide.images[name]?.assetId ? e.slide.hasPicture : e.slide.noPicture}
                        </span>
                        <RegeneratePopover
                          path={path}
                          fieldLabel={format(e.field.image, { slot: name, n })}
                          label={e.slide.regeneratePicture}
                        />
                      </div>
                      <RegenerationDiff path={path} />
                    </div>
                  );
                })}
              </section>
            ) : null}

            <section className="flex flex-col gap-1.5 text-xs">
              <h3 className="font-medium tracking-wide text-muted-foreground uppercase">
                {e.slide.cites}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {slide.knowledgeIds.length > 0 ? (
                  slide.knowledgeIds.map((id) => (
                    <Badge key={id} variant="outline">
                      {cardTitles[id] ?? id}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">{messages.review.notFactual}</span>
                )}
              </div>
            </section>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

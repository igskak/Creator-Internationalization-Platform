"use client";

import type { RenderView } from "@rc/modules/content";
import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { SlidePreview } from "./slide-preview";

/**
 * The rendered carousel (plan 08 §8.5, M3-13): a 4:5 frame with swipe (scroll snap), previous and
 * next, thumbnails, a 1:1 zoom and the QA badges. The images are the authoritative JPEGs; while a
 * render is stale the live HTML preview of the slide takes their place, with "Re-rendering…".
 */
export function CarouselViewer({
  variantId,
  render,
  slideIds,
}: {
  variantId: string;
  render: RenderView;
  /** Ids of the variant's slides, in order (the live preview needs them when a render is stale). */
  slideIds: readonly string[];
}) {
  const { messages } = useI18n();
  const t = messages.review.viewer;
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);

  const count = slideIds.length;
  const stale = render.state === "STALE" || render.state === "RENDERING";
  const files = new Map(render.slides.map((s) => [s.slideId, s.url]));
  const go = (index: number) => {
    const next = Math.min(count - 1, Math.max(0, index));
    setActive(next);
    const el = track.current;
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  if (render.state === "NONE" || (render.state === "RENDERING" && render.slides.length === 0)) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {render.state === "NONE" ? t.none : t.rendering}
      </p>
    );
  }
  if (render.state === "FAILED" && render.slides.length === 0) {
    return (
      <div role="alert" className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950/40">
        <p className="font-medium">{t.failed}</p>
        {render.error ? <p>{render.error}</p> : null}
        <QaBadges qa={render.qa} />
      </div>
    );
  }

  const url = (slideId: string) => files.get(slideId);
  const zoomed = slideIds[active] ? url(slideIds[active] as string) : undefined;

  return (
    <div className="flex flex-col gap-2" data-testid="carousel-viewer" data-state={render.state}>
      <div className="flex flex-wrap items-center gap-1.5">
        {stale ? (
          <Badge variant="secondary" aria-live="polite">
            {t.rerendering}
          </Badge>
        ) : null}
        <QaBadges qa={render.qa} />
      </div>

      <div className="relative mx-auto w-full max-w-72">
        <section
          ref={track}
          onScroll={(event) => {
            const el = event.currentTarget;
            setActive(Math.round(el.scrollLeft / el.clientWidth));
          }}
          className="flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto rounded-lg border bg-muted [scrollbar-width:none]"
          aria-roledescription="carousel"
          aria-label={t.label}
        >
          {slideIds.map((slideId, i) => (
            <div key={slideId} className="relative h-full w-full flex-none snap-center">
              {stale || !url(slideId) ? (
                <SlidePreview
                  variantId={variantId}
                  slideId={slideId}
                  title={format(t.slideOf, { n: i + 1, total: count })}
                />
              ) : (
                // biome-ignore lint/performance/noImgElement: presigned storage URL, not an optimizable asset
                <img
                  src={url(slideId)}
                  alt={format(t.slideOf, { n: i + 1, total: count })}
                  className="h-full w-full object-cover"
                  loading={i === 0 ? "eager" : "lazy"}
                />
              )}
            </div>
          ))}
        </section>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t.previous}
            disabled={active === 0}
            onClick={() => go(active - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {format(t.slideOf, { n: active + 1, total: count })}
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t.zoom}
              disabled={!zoomed || stale}
              onClick={() => setZoom(true)}
            >
              <ZoomInIcon />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t.next}
              disabled={active >= count - 1}
              onClick={() => go(active + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>

      <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label={t.thumbnails}>
        {slideIds.map((slideId, i) => (
          <li key={slideId} className="flex-none">
            <button
              type="button"
              onClick={() => go(i)}
              aria-label={format(t.goTo, { n: i + 1 })}
              aria-current={i === active}
              className={cn(
                "block h-14 w-11 overflow-hidden rounded border bg-muted",
                i === active && "ring-2 ring-ring",
              )}
            >
              {url(slideId) && !stale ? (
                // biome-ignore lint/performance/noImgElement: presigned storage URL
                <img src={url(slideId)} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full place-items-center text-[10px] text-muted-foreground">
                  {i + 1}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-h-[90vh] max-w-[90vw] overflow-auto sm:max-w-fit">
          <DialogHeader>
            <DialogTitle>{t.zoomTitle}</DialogTitle>
          </DialogHeader>
          {zoomed ? (
            // biome-ignore lint/performance/noImgElement: presigned storage URL, shown at its pixel size
            <img
              src={zoomed}
              alt={format(t.slideOf, { n: active + 1, total: count })}
              width={1080}
              height={1350}
              className="max-w-none"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** What the render QA found (08 §8.6), as small badges; nothing when all is well. */
function QaBadges({ qa }: { qa: RenderView["qa"] }) {
  const { messages } = useI18n();
  const t = messages.review.viewer;
  if (!qa) return null;
  const items: string[] = [];
  if (qa.overflow.length > 0) items.push(format(t.qaOverflow, { count: qa.overflow.length }));
  if (qa.missingGlyphs.length > 0) {
    items.push(format(t.qaGlyphs, { chars: qa.missingGlyphs.flatMap((g) => g.chars).join(" ") }));
  }
  if (!qa.dimensionsOk) items.push(t.qaDimensions);
  if (!qa.logoPlacementOk) items.push(t.qaLogo);
  if (items.length === 0) {
    return qa.fileSizes.length > 0 ? <Badge variant="secondary">{t.qaOk}</Badge> : null;
  }
  return (
    <>
      {items.map((item) => (
        <Badge key={item} variant="destructive">
          {item}
        </Badge>
      ))}
    </>
  );
}

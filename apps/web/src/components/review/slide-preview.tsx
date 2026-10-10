"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CANVAS = { width: 1080, height: 1350 };

/**
 * The live HTML preview of one slide (plan 08 §8.5): the page the renderer would export, fetched
 * from /api/preview/slide and shown in a sandboxed iframe, scaled with a CSS transform to fit its
 * frame. `slots` are unsaved values of a draft. The sandbox has no `allow-same-origin`, so the
 * page's script runs but cannot reach the app.
 */
export function SlidePreview({
  variantId,
  slideId,
  slots,
  title,
  className,
}: {
  variantId: string;
  slideId: string;
  slots?: Record<string, string>;
  title: string;
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(0);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const draft = slots ? JSON.stringify(slots) : "";

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetch("/api/preview/slide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId, slideId, ...(draft ? { slots: JSON.parse(draft) } : {}) }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("preview"))))
      .then(setHtml)
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [variantId, slideId, draft]);

  useEffect(() => {
    if (!frame) return;
    const update = () => setScale(frame.clientWidth / CANVAS.width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);

  return (
    <div
      ref={setFrame}
      className={cn("relative aspect-[4/5] w-full overflow-hidden bg-muted", className)}
      data-testid="slide-preview"
    >
      {html && scale > 0 ? (
        <iframe
          title={title}
          sandbox="allow-scripts"
          srcDoc={html}
          width={CANVAS.width}
          height={CANVAS.height}
          style={{
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      ) : null}
      {failed ? (
        <p role="alert" className="absolute inset-0 grid place-items-center p-4 text-sm">
          !
        </p>
      ) : null}
    </div>
  );
}

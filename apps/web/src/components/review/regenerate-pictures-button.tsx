"use client";

import { ImageIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { regenerateVisuals } from "@/server/actions/content";
import { useVariant } from "./variant-state";

const EVERY_MS = 4000;
const GIVE_UP_MS = 10 * 60 * 1000;

/**
 * "Regenerate pictures" under the carousel: the pictures of this market only are replanned and
 * redrawn, the text stays. Until the new carousel is rendered the page is refreshed every few
 * seconds (while it renders, the review poller does it).
 */
export function RegeneratePicturesButton({
  enabled,
  renderId,
  renderBusy,
}: {
  /** The draft is in review (an approved one must be withdrawn first). */
  enabled: boolean;
  /** The current render; a new one means the new pictures are in. */
  renderId: string | null;
  /** The carousel is rendering or out of date: the review poller refreshes the page. */
  renderBusy: boolean;
}) {
  const t = useI18n().messages.review.viewer;
  const router = useRouter();
  const variant = useVariant();
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState<{ renderId: string | null; at: number } | null>(null);
  const { run, pending } = useAction(regenerateVisuals, {
    onSuccess: () => {
      setOpen(false);
      setSince({ renderId, at: Date.now() });
      toast(t.regenerateQueued);
    },
  });

  useEffect(() => {
    if (!since) return;
    if (since.renderId !== renderId) {
      setSince(null);
      return;
    }
    if (renderBusy) return;
    const timer = setInterval(() => {
      if (Date.now() - since.at > GIVE_UP_MS) {
        clearInterval(timer);
        setSince(null);
      } else router.refresh();
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [since, renderId, renderBusy, router]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!enabled || since !== null}
              title={enabled ? undefined : t.regenerateBlocked}
            />
          }
        >
          <ImageIcon /> {t.regenerate}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.regenerateTitle}</DialogTitle>
            <DialogDescription>{t.regenerateDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => void run({ variantId: variant.variantId })}
            >
              {t.regenerateSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {since ? (
        <Badge variant="secondary" aria-live="polite">
          {t.regenerating}
        </Badge>
      ) : null}
    </div>
  );
}

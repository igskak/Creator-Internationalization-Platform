"use client";

import { GitMergeIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { mergeDuplicateCards } from "@/server/actions/knowledge";

/** Archives this card as a duplicate of the one it was found to repeat (chef or owner). */
export function MergeIntoOriginal({
  cardId,
  original,
  canMerge,
}: {
  cardId: string;
  original: { id: string; title: string };
  canMerge: boolean;
}) {
  const t = useI18n().messages.card.merge;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const merge = useAction(mergeDuplicateCards, {
    onSuccess: () => {
      setOpen(false);
      toast.success(t.done);
      router.refresh();
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={!canMerge}
        title={canMerge ? undefined : t.onlyChef}
        onClick={() => setOpen(true)}
      >
        <GitMergeIcon /> {t.button}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{format(t.body, { title: original.title })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={merge.pending}>
              {t.cancel}
            </Button>
            <Button
              disabled={merge.pending}
              onClick={() => merge.run({ keepId: original.id, duplicateIds: [cardId] })}
            >
              {t.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

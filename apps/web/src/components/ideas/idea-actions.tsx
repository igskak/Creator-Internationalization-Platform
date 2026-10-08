"use client";

import { ArchiveIcon, CheckIcon, RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FieldBlock } from "@/components/knowledge/field-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { generateVariants, transitionIdea } from "@/server/actions/content";

type To = "ACCEPTED" | "REJECTED" | "ARCHIVED" | "PROPOSED";

/** What can be done with an idea in its status (plan 10 §10.4.2). */
export function IdeaActions({
  ideaId,
  status,
  cardsApproved,
}: {
  ideaId: string;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "ARCHIVED";
  /** Every linked card is still approved: accepting needs it. */
  cardsApproved: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.ideas.actions;
  const router = useRouter();
  const [dialog, setDialog] = useState<"reject" | "archive" | null>(null);
  const [reason, setReason] = useState("");

  const move = useAction(transitionIdea, {
    onSuccess: () => {
      setDialog(null);
      setReason("");
      router.refresh();
    },
  });
  const drafts = useAction(generateVariants, {
    onSuccess: () => {
      toast.success(t.draftsQueued);
      router.refresh();
    },
  });
  const go = (to: To, message: string, extra: { reason?: string } = {}) => {
    void move.run({ id: ideaId, to, ...extra }).then((result) => {
      if (result.ok) toast.success(message);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "PROPOSED" ? (
        <>
          <Button
            disabled={move.pending || !cardsApproved}
            title={cardsApproved ? undefined : t.acceptNeedsCards}
            onClick={() => go("ACCEPTED", t.accepted)}
          >
            <CheckIcon /> {t.accept}
          </Button>
          <Button variant="outline" disabled={move.pending} onClick={() => setDialog("reject")}>
            <XIcon /> {t.reject}
          </Button>
        </>
      ) : null}
      {status === "ACCEPTED" ? (
        <Button
          variant="outline"
          disabled={drafts.pending}
          onClick={() => void drafts.run({ masterIdeaId: ideaId })}
        >
          <SparklesIcon /> {t.generateDrafts}
        </Button>
      ) : null}
      {status === "REJECTED" || status === "ARCHIVED" ? (
        <Button
          variant="outline"
          disabled={move.pending}
          onClick={() => go("PROPOSED", t.restored)}
        >
          <RotateCcwIcon /> {t.restore}
        </Button>
      ) : null}
      {status !== "ARCHIVED" ? (
        <Button variant="ghost" disabled={move.pending} onClick={() => setDialog("archive")}>
          <ArchiveIcon /> {t.archive}
        </Button>
      ) : null}
      {status === "PROPOSED" && !cardsApproved ? (
        <p role="note" className="w-full text-sm text-muted-foreground">
          {t.acceptNeedsCards}
        </p>
      ) : null}

      <Dialog open={dialog === "reject"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.rejectDialog.title}</DialogTitle>
            <DialogDescription>{t.rejectDialog.description}</DialogDescription>
          </DialogHeader>
          <FieldBlock
            label={t.rejectDialog.reason}
            htmlFor="reject-reason"
            error={move.fieldErrors?.reason?.[0]}
          >
            <Textarea
              id="reject-reason"
              rows={3}
              maxLength={500}
              placeholder={t.rejectDialog.placeholder}
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
            />
          </FieldBlock>
          <DialogFooter>
            <Button variant="outline" disabled={move.pending} onClick={() => setDialog(null)}>
              {t.rejectDialog.cancel}
            </Button>
            <Button
              disabled={move.pending || !reason.trim()}
              onClick={() => go("REJECTED", t.rejected, { reason: reason.trim() })}
            >
              {t.rejectDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "archive"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.archiveDialog.title}</DialogTitle>
            <DialogDescription>{t.archiveDialog.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={move.pending} onClick={() => setDialog(null)}>
              {t.archiveDialog.cancel}
            </Button>
            <Button disabled={move.pending} onClick={() => go("ARCHIVED", t.archived)}>
              {t.archiveDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

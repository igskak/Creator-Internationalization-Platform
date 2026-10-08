"use client";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { regenerateAllVariants } from "@/server/actions/content";

/** "Regenerate all" (plan 10 §10.3): one new run for every draft of the idea, with a reason. */
export function RegenerateAllDialog({
  ideaId,
  reasons,
  disabled,
}: {
  ideaId: string;
  reasons: { code: string; label: string }[];
  disabled: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.review;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [reasonCode, setReasonCode] = useState(reasons[0]?.code ?? "");
  const { run, pending, fieldErrors } = useAction(regenerateAllVariants, {
    onSuccess: () => {
      setOpen(false);
      setInstruction("");
      toast.success(t.regenerateQueued);
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        <RefreshCwIcon /> {t.regenerateAll}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.regenerateTitle}</DialogTitle>
          <DialogDescription>{t.regenerateDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              masterIdeaId: ideaId,
              reasonCode,
              ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
            });
          }}
        >
          <FieldBlock
            label={t.regenerateReason}
            htmlFor="regen-reason"
            error={fieldErrors?.reasonCode?.[0]}
          >
            <select
              id="regen-reason"
              className={selectClass}
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
            >
              {reasons.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.label}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock
            label={t.regenerateInstruction}
            htmlFor="regen-instruction"
            hint={t.regenerateInstructionHint}
            error={fieldErrors?.instruction?.[0]}
          >
            <Textarea
              id="regen-instruction"
              rows={3}
              maxLength={500}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </FieldBlock>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending || !reasonCode}>
              {t.regenerateSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

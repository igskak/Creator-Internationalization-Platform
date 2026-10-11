"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldBlock } from "@/components/knowledge/field-block";
import { Badge } from "@/components/ui/badge";
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
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { setPublishingEnabled } from "@/server/actions/publishing";

/** The owner's kill switch (plan 10 §10.1), with the environment's limits stated next to it. */
export function PublishingSwitch({
  enabled,
  mode,
  allowlist,
  isOwner,
}: {
  enabled: boolean;
  mode: "off" | "dry_run_only" | "live";
  allowlist: readonly string[];
  isOwner: boolean;
}) {
  const t = useI18n().messages.publishing.switch;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const target = !enabled;
  const action = useAction(setPublishingEnabled, {
    successMessage: target ? t.switchedOn : t.switchedOff,
    toastOnError: false,
    onSuccess: () => {
      setOpen(false);
      setReason("");
      router.refresh();
    },
  });

  return (
    <section aria-label={t.title} className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <Badge variant={enabled ? "default" : "secondary"}>{enabled ? t.on : t.off}</Badge>
      </header>
      <p className="text-sm text-muted-foreground">{t.description}</p>
      {mode === "off" && <p className="text-sm">{t.environmentOff}</p>}
      {mode === "dry_run_only" && <p className="text-sm">{t.environmentDryRun}</p>}
      <p className="text-sm text-muted-foreground">
        {allowlist.length > 0 ? format(t.allowlist, { ids: allowlist.join(", ") }) : t.noAllowlist}
      </p>
      {isOwner ? (
        <div>
          <Button variant={enabled ? "outline" : "default"} onClick={() => setOpen(true)}>
            {enabled ? t.turnOff : t.turnOn}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t.ownersOnly}</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target ? t.dialogOnTitle : t.dialogOffTitle}</DialogTitle>
            <DialogDescription>
              {target ? t.dialogOnDescription : t.dialogOffDescription}
            </DialogDescription>
          </DialogHeader>
          <FieldBlock
            label={t.reasonLabel}
            htmlFor="kill-switch-reason"
            error={action.fieldErrors?.reason?.[0] ?? action.error?.message}
          >
            <Textarea
              id="kill-switch-reason"
              value={reason}
              placeholder={t.reasonPlaceholder}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </FieldBlock>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              disabled={action.pending || reason.trim() === ""}
              onClick={() => void action.run({ enabled: target, reason })}
            >
              {t.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

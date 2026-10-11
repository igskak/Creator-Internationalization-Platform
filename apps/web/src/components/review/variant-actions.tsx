"use client";

import type { AllowedAction } from "@rc/modules/content";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
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
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import type { ActionResult } from "@/lib/action-result";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import {
  approveVariant,
  rejectVariant,
  requestChanges,
  resubmitVariant,
  triggerRender,
  unapproveVariant,
} from "@/server/actions/content";
import { useVariant } from "./variant-state";

type Checklist = "factsChecked" | "safetyChecked" | "manychatConfigured";
type Dialogs = "approve" | "changes" | "reject" | "unapprove" | null;

const RERENDER = new Set(["RENDER_MISSING", "RENDER_STALE", "RENDER_FAILED"]);

/**
 * The buttons of a draft, driven by the server's allowed actions (plan 10 §10.3, M4-06): approve
 * (with its checklist and, while it is blocked, the list of what blocks it), request changes,
 * resubmit, reject, and withdraw the approval. Scheduling joins them in M4-09.
 */
export function VariantActions({
  allowed,
  flagLabels,
}: {
  allowed: AllowedAction[];
  flagLabels: Record<string, string>;
}) {
  const { messages } = useI18n();
  const t = messages.review.actions;
  const router = useRouter();
  const variant = useVariant();
  const [open, setOpen] = useState<Dialogs>(null);
  const has = (action: AllowedAction["action"]) => allowed.find((a) => a.action === action);
  const approve = has("approve");
  const { run: rerender, pending: rerendering } = useAction(triggerRender, {
    successMessage: t.rerenderQueued,
    onSuccess: () => router.refresh(),
  });
  const { run: resubmit, pending: resubmitting } = useAction(resubmitVariant, {
    successMessage: t.resubmitToast,
    onSuccess: () => router.refresh(),
  });

  const blockerText = (blocker: AllowedAction["blockers"][number]) =>
    format(t.blocker[blocker.code], {
      flag: blocker.flag ? (flagLabels[blocker.flag] ?? blocker.flag) : "",
    });
  const needsRender = approve?.blockers.some((b) => RERENDER.has(b.code)) ?? false;

  return (
    <div className="flex flex-col gap-2" data-testid="variant-actions">
      <div className="flex flex-wrap gap-2">
        {approve ? (
          <Button type="button" disabled={!approve.enabled} onClick={() => setOpen("approve")}>
            {t.approve}
          </Button>
        ) : null}
        {has("resubmit") ? (
          <Button
            type="button"
            disabled={resubmitting}
            onClick={() => void resubmit({ variantId: variant.variantId })}
          >
            {t.resubmit}
          </Button>
        ) : null}
        {has("requestChanges") ? (
          <Button type="button" variant="outline" onClick={() => setOpen("changes")}>
            {t.requestChanges}
          </Button>
        ) : null}
        {has("reject") ? (
          <Button type="button" variant="destructive" onClick={() => setOpen("reject")}>
            {t.reject}
          </Button>
        ) : null}
        {has("unapprove") ? (
          <Button type="button" variant="outline" onClick={() => setOpen("unapprove")}>
            {t.unapprove}
          </Button>
        ) : null}
        {needsRender ? (
          <Button
            type="button"
            variant="outline"
            disabled={rerendering}
            onClick={() => void rerender({ variantId: variant.variantId })}
          >
            {t.rerender}
          </Button>
        ) : null}
      </div>

      {approve && !approve.enabled ? (
        <div className="text-sm text-muted-foreground" data-testid="approve-blockers">
          <p>{t.notReady}</p>
          <ul className="list-disc pl-5">
            {approve.blockers.map((blocker) => (
              <li key={`${blocker.code}-${blocker.flag ?? ""}`}>{blockerText(blocker)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ApproveDialog
        open={open === "approve"}
        onClose={() => setOpen(null)}
        checklist={(approve?.checklist ?? ["factsChecked"]) as Checklist[]}
      />
      <ReasonDialog
        open={open === "changes"}
        onClose={() => setOpen(null)}
        title={t.requestChangesTitle}
        description={t.requestChangesDescription}
        detailsLabel={t.requestChangesDetails}
        detailsRequired
        codeRequired
        submitLabel={t.requestChangesSubmit}
        successMessage={t.changesToast}
        submit={(input) =>
          requestChanges({
            variantId: variant.variantId,
            reasonCode: input.reasonCode,
            reason: input.details,
          })
        }
      />
      <ReasonDialog
        open={open === "reject"}
        onClose={() => setOpen(null)}
        title={t.rejectTitle}
        description={t.rejectDescription}
        detailsLabel={t.rejectDetails}
        codeRequired
        destructive
        submitLabel={t.rejectSubmit}
        successMessage={t.rejectToast}
        submit={(input) =>
          rejectVariant({
            variantId: variant.variantId,
            reasonCode: input.reasonCode,
            ...(input.details ? { reason: input.details } : {}),
          })
        }
      />
      <ReasonDialog
        open={open === "unapprove"}
        onClose={() => setOpen(null)}
        title={t.unapproveTitle}
        description={t.unapproveDescription}
        detailsLabel={t.unapproveDetails}
        detailsRequired
        submitLabel={t.unapproveSubmit}
        successMessage={t.unapproveToast}
        submit={(input) =>
          unapproveVariant({ variantId: variant.variantId, reason: input.details })
        }
      />
    </div>
  );
}

function ApproveDialog({
  open,
  onClose,
  checklist,
}: {
  open: boolean;
  onClose: () => void;
  checklist: Checklist[];
}) {
  const { messages } = useI18n();
  const t = messages.review.actions;
  const router = useRouter();
  const variant = useVariant();
  const [ticked, setTicked] = useState<Partial<Record<Checklist, boolean>>>({});
  const { run, pending, error } = useAction(approveVariant, {
    toastOnError: false,
    onSuccess: (data) => {
      onClose();
      setTicked({});
      toast.success(format(t.approvedToast, { n: data.versionNo }));
      router.refresh();
    },
    onError: (e) => {
      if (e.code === "CONFLICT") variant.setConflict(true);
    },
  });
  const all = checklist.every((item) => ticked[item] === true);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.approveTitle}</DialogTitle>
          <DialogDescription>{t.approveDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              variantId: variant.variantId,
              lockVersion: variant.lockVersion,
              checklist: {
                factsChecked: ticked.factsChecked === true,
                ...(checklist.includes("safetyChecked")
                  ? { safetyChecked: ticked.safetyChecked === true }
                  : {}),
                ...(checklist.includes("manychatConfigured")
                  ? { manychatConfigured: ticked.manychatConfigured === true }
                  : {}),
              },
            });
          }}
        >
          <ul className="flex flex-col gap-2">
            {checklist.map((item) => (
              <li key={item}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ticked[item] === true}
                    onChange={(event) => setTicked((p) => ({ ...p, [item]: event.target.checked }))}
                  />
                  {t.checklist[item]}
                </label>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={!all || pending}>
              {pending ? t.working : t.approveSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  open,
  onClose,
  title,
  description,
  detailsLabel,
  detailsRequired,
  codeRequired,
  destructive,
  submitLabel,
  successMessage,
  submit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  detailsLabel: string;
  detailsRequired?: boolean;
  codeRequired?: boolean;
  destructive?: boolean;
  submitLabel: string;
  successMessage: string;
  submit: (input: {
    reasonCode: string;
    details: string;
  }) => Promise<ActionResult<{ status: string; lockVersion: number }>>;
}) {
  const { messages } = useI18n();
  const t = messages.review.actions;
  const router = useRouter();
  const variant = useVariant();
  const [reasonCode, setReasonCode] = useState("");
  const [details, setDetails] = useState("");
  const { run, pending, error, fieldErrors } = useAction(submit, {
    toastOnError: false,
    onSuccess: () => {
      onClose();
      setReasonCode("");
      setDetails("");
      toast.success(successMessage);
      router.refresh();
    },
  });
  const ready = (!codeRequired || reasonCode !== "") && (!detailsRequired || details.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run({ reasonCode, details: details.trim() });
          }}
        >
          {codeRequired ? (
            <FieldBlock
              label={t.reason}
              htmlFor="decision-reason"
              error={fieldErrors?.reasonCode?.[0]}
            >
              <select
                id="decision-reason"
                className={selectClass}
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
              >
                <option value="">{t.chooseReason}</option>
                {variant.reasons.map((reason) => (
                  <option key={reason.code} value={reason.code}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </FieldBlock>
          ) : null}
          <FieldBlock
            label={detailsLabel}
            htmlFor="decision-details"
            error={fieldErrors?.reason?.[0]}
          >
            <Textarea
              id="decision-details"
              rows={3}
              maxLength={1000}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
            />
          </FieldBlock>
          {error && !fieldErrors ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={!ready || pending}
            >
              {pending ? t.working : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

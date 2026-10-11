"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { regenerateVariantField } from "@/server/actions/content";
import { useVariant } from "./variant-state";

/**
 * "↻" next to a field (plan 10 §10.3): an optional instruction (≤ 500 characters) and a reason
 * code, then the model redoes only that field. The result appears as old versus new with Keep and
 * Undo once the job is done (the page is refreshed when the draft changes).
 */
export function RegeneratePopover({
  path,
  fieldLabel,
  label,
  disabled,
}: {
  path: string;
  /** "hook", "slide 2" … for the messages. */
  fieldLabel: string;
  label?: string;
  disabled?: boolean;
}) {
  const t = useI18n().messages.review.edit;
  const variant = useVariant();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const { run, pending, fieldErrors } = useAction(regenerateVariantField);

  const submit = async () => {
    if (variant.confirmKind && !(await variant.askConfirm())) return;
    const fromLock = variant.lockVersion;
    const result = await run({
      variantId: variant.variantId,
      lockVersion: fromLock,
      field: path,
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      ...(variant.confirmKind ? { confirmed: true } : {}),
    });
    if (!result.ok) {
      if (result.error.code === "CONFLICT") variant.setConflict(true);
      return;
    }
    setOpen(false);
    setInstruction("");
    toast(format(t.regen.queued, { field: fieldLabel }));
    void variant.waitForChange(fromLock).then((changed) => {
      if (changed) toast.success(format(t.regen.done, { field: fieldLabel }));
      else toast(t.regen.noChange);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled || variant.editBlocker !== null}
            aria-label={label ?? format(t.regen.title, { field: fieldLabel })}
            title={variant.editBlocker ?? undefined}
          />
        }
      >
        <RefreshCwIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        <p className="font-medium">{format(t.regen.title, { field: fieldLabel })}</p>
        <FieldBlock
          label={t.regen.instruction}
          htmlFor={`regen-${path}`}
          hint={t.regen.instructionHint}
          error={fieldErrors?.instruction?.[0]}
        >
          <Textarea
            id={`regen-${path}`}
            rows={3}
            maxLength={500}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </FieldBlock>
        <FieldBlock
          label={t.regen.reason}
          htmlFor={`regen-reason-${path}`}
          error={fieldErrors?.reasonCode?.[0]}
        >
          <select
            id={`regen-reason-${path}`}
            className={selectClass}
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
          >
            <option value="" />
            {variant.reasons.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </select>
        </FieldBlock>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t.cancel}
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={() => void submit()}>
            {t.regen.submit}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

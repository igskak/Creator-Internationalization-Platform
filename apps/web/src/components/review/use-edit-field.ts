"use client";

import type { ValidationIssue } from "@rc/db/json";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { editVariantField } from "@/server/actions/content";
import { useVariant } from "./variant-state";

/**
 * Saves one field of the draft (plan 05 §5.7 `editVariantField`): sends the lock version, asks
 * before an approval is undone, and keeps the person's text on a conflict (the editor stays open
 * with a Reload banner). Returns whether the value was saved.
 */
export function useEditField() {
  const variant = useVariant();
  const router = useRouter();
  const t = useI18n().messages.review.edit;
  const { run, pending } = useAction(editVariantField, { toastOnError: false });
  const [error, setError] = useState<string | undefined>();
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);

  const save = useCallback(
    async (field: string, value: unknown, extra: { reasonCode?: string; quiet?: boolean } = {}) => {
      setError(undefined);
      setWarnings([]);
      if (variant.confirmKind && !(await variant.askConfirm())) return false;
      const result = await run({
        variantId: variant.variantId,
        lockVersion: variant.lockVersion,
        field,
        value,
        ...(extra.reasonCode ? { reasonCode: extra.reasonCode } : {}),
        ...(variant.confirmKind ? { confirmed: true } : {}),
      });
      if (result.ok) {
        variant.setLockVersion(result.data.lockVersion);
        setWarnings(result.data.warnings);
        if (!extra.quiet) {
          if (result.data.reviewEventId === null) toast(t.unchanged);
          else toast.success(t.saved);
        }
        router.refresh();
        return true;
      }
      if (result.error.code === "CONFLICT") {
        variant.setConflict(true);
        toast.error(result.error.message, {
          action: { label: t.reload, onClick: () => router.refresh() },
        });
        return false;
      }
      setError(result.error.fieldErrors?.value?.[0] ?? result.error.message);
      return false;
    },
    [run, router, t, variant],
  );

  return { save, pending, error, warnings };
}

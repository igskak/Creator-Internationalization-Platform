"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { useVariant } from "./variant-state";

/** Shown after a CONFLICT: the person's unsaved text stays in its editor; Reload fetches the latest draft. */
export function ConflictBanner() {
  const t = useI18n().messages.review.edit;
  const { conflict, setConflict } = useVariant();
  const router = useRouter();
  if (!conflict) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/40"
    >
      <p>{t.conflictBanner}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setConflict(false);
          router.refresh();
        }}
      >
        {t.reload}
      </Button>
    </div>
  );
}

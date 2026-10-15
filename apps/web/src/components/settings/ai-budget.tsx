"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { setAppSetting } from "@/server/actions/settings";

/** The monthly AI budget (`ai.monthly_budget_usd`, H-05). Owners only. */
export function AiBudgetForm({ budgetUsd }: { budgetUsd: number | null }) {
  const t = useI18n().messages.aiSettings.budget;
  const router = useRouter();
  const [value, setValue] = useState(budgetUsd === null ? "0" : String(budgetUsd));
  const action = useAction(setAppSetting, {
    successMessage: t.saved,
    onSuccess: () => router.refresh(),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({
          key: "ai.monthly_budget_usd",
          value: Number(value.replace(",", ".")) || 0,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm" htmlFor="ai-budget">
        {t.label}
        <Input
          id="ai-budget"
          inputMode="decimal"
          className="w-40"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <Button type="submit" size="sm" disabled={action.pending}>
        {t.save}
      </Button>
    </form>
  );
}

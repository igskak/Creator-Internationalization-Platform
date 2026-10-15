"use client";

import type { ArmChoice } from "@rc/modules/analytics";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { selectClass } from "@/components/knowledge/field-block";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { assignExperimentArmAction } from "@/server/actions/experiments";

/** The experiment arm of one draft (M7-06): pick an open experiment of the market and A or B. */
export function ExperimentArmPicker({
  variantId,
  choice,
  canManage,
}: {
  variantId: string;
  choice: ArmChoice;
  canManage: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.experiments.picker;
  const router = useRouter();
  const [experimentId, setExperimentId] = useState(
    choice.current?.experimentId ?? choice.open[0]?.id ?? "",
  );
  const [arm, setArm] = useState<"A" | "B">(choice.current?.arm ?? "A");
  const run = useAction(assignExperimentArmAction, {
    onSuccess: () => {
      toast.success(t.saved);
      router.refresh();
    },
  });
  const selected = choice.open.find((x) => x.id === experimentId);
  if (!choice.current && choice.open.length === 0) {
    return <p className="text-xs text-muted-foreground">{t.noOpen}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="experiment-arm">
      <p className="text-sm">
        {choice.current
          ? format(t.assigned, { arm: choice.current.arm, name: choice.current.name })
          : t.none}
      </p>
      {canManage && choice.open.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t.title}
            className={`${selectClass} w-auto max-w-56`}
            value={experimentId}
            onChange={(e) => setExperimentId(e.target.value)}
          >
            {choice.open.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t.arm}
            className={`${selectClass} w-auto`}
            value={arm}
            onChange={(e) => setArm(e.target.value as "A" | "B")}
          >
            <option value="A">A: {selected?.variantA ?? ""}</option>
            <option value="B">B: {selected?.variantB ?? ""}</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={run.pending || !experimentId}
            onClick={() => void run.run({ variantId, experimentId, arm })}
          >
            {t.save}
          </Button>
          {choice.current ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={run.pending}
              onClick={() => void run.run({ variantId, experimentId: null })}
            >
              {t.clear}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

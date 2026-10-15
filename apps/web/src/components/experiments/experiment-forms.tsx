"use client";

import { PlusIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { setExperimentStatusAction, upsertExperimentAction } from "@/server/actions/experiments";

// The forms of /experiments (M7-06): create (or edit a draft) and move one through its states.

export type MarketChoice = {
  id: string;
  label: string;
  hypotheses: { id: string; description: string; status: string }[];
};
export type DimensionChoice = { value: string; label: string };

export type ExperimentDraft = {
  id?: string;
  name: string;
  hypothesis: string;
  marketId: string;
  dimension: string;
  variantA: string;
  variantB: string;
  primaryMetric: "save_rate" | "share_rate";
  minPostsPerArm: number;
  visualHypothesisId: string;
  notes: string;
};

export function ExperimentDialog({
  markets,
  dimensions,
  initial,
}: {
  markets: MarketChoice[];
  dimensions: DimensionChoice[];
  initial?: ExperimentDraft;
}) {
  const { messages } = useI18n();
  const t = messages.experiments;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const empty: ExperimentDraft = {
    name: "",
    hypothesis: "",
    marketId: markets[0]?.id ?? "",
    dimension: "visual_style",
    variantA: "",
    variantB: "",
    primaryMetric: "save_rate",
    minPostsPerArm: 5,
    visualHypothesisId: "",
    notes: "",
  };
  const [form, setForm] = useState<ExperimentDraft>(initial ?? empty);
  const set = <K extends keyof ExperimentDraft>(key: K, value: ExperimentDraft[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const run = useAction(upsertExperimentAction, {
    toastOnError: false,
    onSuccess: () => {
      toast.success(t.form.saved);
      setOpen(false);
      if (!initial) setForm(empty);
      router.refresh();
    },
  });
  const err = (field: string) => run.fieldErrors?.[field]?.[0];
  const market = markets.find((m) => m.id === form.marketId);
  const submit = () =>
    run.run({
      ...(form.id ? { id: form.id } : {}),
      name: form.name,
      hypothesis: form.hypothesis,
      marketId: form.marketId,
      dimension: form.dimension as never,
      variantA: form.variantA.trim(),
      variantB: form.variantB.trim(),
      primaryMetric: form.primaryMetric,
      minPostsPerArm: Number(form.minPostsPerArm) || 5,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      ...(form.dimension === "visual_style" && form.visualHypothesisId
        ? { visualHypothesisId: form.visualHypothesisId }
        : {}),
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={initial ? "outline" : "default"} />}>
        {initial ? (
          t.edit
        ) : (
          <>
            <PlusIcon /> {t.new}
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? t.edit : t.new}</DialogTitle>
          <DialogDescription>{t.subtitle}</DialogDescription>
        </DialogHeader>
        <FieldBlock label={t.form.name} htmlFor="x-name" error={err("name")}>
          <Input id="x-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </FieldBlock>
        <FieldBlock
          label={t.form.hypothesis}
          htmlFor="x-hyp"
          hint={t.form.hypothesisHint}
          error={err("hypothesis")}
        >
          <Input
            id="x-hyp"
            value={form.hypothesis}
            onChange={(e) => set("hypothesis", e.target.value)}
          />
        </FieldBlock>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label={t.form.market} htmlFor="x-market" error={err("marketId")}>
            <select
              id="x-market"
              className={selectClass}
              value={form.marketId}
              onChange={(e) => set("marketId", e.target.value)}
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label={t.form.dimension} htmlFor="x-dim" error={err("dimension")}>
            <select
              id="x-dim"
              className={selectClass}
              value={form.dimension}
              onChange={(e) => set("dimension", e.target.value)}
            >
              {dimensions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label={t.form.a} htmlFor="x-a" hint={t.form.armHint} error={err("variantA")}>
            <Input
              id="x-a"
              value={form.variantA}
              onChange={(e) => set("variantA", e.target.value)}
            />
          </FieldBlock>
          <FieldBlock label={t.form.b} htmlFor="x-b" error={err("variantB")}>
            <Input
              id="x-b"
              value={form.variantB}
              onChange={(e) => set("variantB", e.target.value)}
            />
          </FieldBlock>
          <FieldBlock label={t.form.metric} htmlFor="x-metric">
            <select
              id="x-metric"
              className={selectClass}
              value={form.primaryMetric}
              onChange={(e) =>
                set("primaryMetric", e.target.value as ExperimentDraft["primaryMetric"])
              }
            >
              <option value="save_rate">{t.metrics.save_rate}</option>
              <option value="share_rate">{t.metrics.share_rate}</option>
            </select>
          </FieldBlock>
          <FieldBlock label={t.form.minPosts} htmlFor="x-min" error={err("minPostsPerArm")}>
            <Input
              id="x-min"
              inputMode="numeric"
              value={String(form.minPostsPerArm)}
              onChange={(e) => set("minPostsPerArm", Number(e.target.value) || 0)}
            />
          </FieldBlock>
        </div>
        {form.dimension === "visual_style" && market && market.hypotheses.length > 0 ? (
          <FieldBlock
            label={t.form.visualHypothesis}
            htmlFor="x-vh"
            error={err("visualHypothesisId")}
          >
            <select
              id="x-vh"
              className={selectClass}
              value={form.visualHypothesisId}
              onChange={(e) => set("visualHypothesisId", e.target.value)}
            >
              <option value="">{t.form.noHypothesis}</option>
              {market.hypotheses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.description} ({h.status})
                </option>
              ))}
            </select>
          </FieldBlock>
        ) : null}
        <FieldBlock label={t.form.notes} htmlFor="x-notes" error={err("notes")}>
          <Input id="x-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </FieldBlock>
        {run.error && !run.fieldErrors ? (
          <p role="alert" className="text-sm text-destructive">
            {run.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={submit} disabled={run.pending}>
            {t.form.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExperimentStatusButtons({
  id,
  status,
  hasHypothesis,
}: {
  id: string;
  status: string;
  hasHypothesis: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.experiments;
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const run = useAction(setExperimentStatusAction, {
    onSuccess: () => {
      toast.success(t.changed);
      setChoosing(false);
      router.refresh();
    },
  });
  if (status === "COMPLETED" || status === "CANCELLED") return null;
  if (choosing) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a row of buttons, not a form group
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.outcome.title}>
        <span className="text-sm">{t.outcome.title}</span>
        {(["CONFIRMED", "REJECTED", "INCONCLUSIVE"] as const).map((o) => (
          <Button
            key={o}
            size="sm"
            variant="outline"
            disabled={run.pending}
            onClick={() => void run.run({ id, status: "COMPLETED", outcome: o })}
          >
            {t.outcome[o]}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" ? (
        <Button
          size="sm"
          disabled={run.pending}
          onClick={() => void run.run({ id, status: "RUNNING" })}
        >
          {t.start}
        </Button>
      ) : null}
      {status === "RUNNING" ? (
        <Button
          size="sm"
          disabled={run.pending}
          onClick={() =>
            hasHypothesis ? setChoosing(true) : void run.run({ id, status: "COMPLETED" })
          }
        >
          {t.complete}
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={run.pending}
        onClick={() => void run.run({ id, status: "CANCELLED" })}
      >
        {t.cancel}
      </Button>
    </div>
  );
}

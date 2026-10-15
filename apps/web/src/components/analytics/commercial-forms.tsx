"use client";

import { PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
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
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import {
  deleteAttributionEventAction,
  importAttributionCsvAction,
  reassignCampaignAction,
  recordAttributionEventAction,
} from "@/server/actions/analytics";

// The forms of the Commercial tab (M6-08): add an event, import a CSV, move the events of an
// unknown campaign id, delete an event. Each refreshes the page when it is done.

export type MarketOption = { id: string; code: string; label: string };

const TYPES = ["LEAD", "SALE", "REFUND"] as const;
const TEMPLATE =
  "type,date,campaign,order id,amount,currency,quantity\nsale,2026-10-01 10:30,rc-es-261001-abc123,A-1001,19.90,EUR,1\nlead,2026-10-01,rc-es-261001-abc123,,,,1\n";

export function AddAttributionDialog({ markets }: { markets: MarketOption[] }) {
  const { messages } = useI18n();
  const t = messages.analytics.commercial.add;
  const types = messages.analytics.commercial.types;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    type: "SALE" as (typeof TYPES)[number],
    date: today,
    campaignId: "",
    marketId: "",
    quantity: "1",
    amount: "",
    externalRef: "",
    notes: "",
  });
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const run = useAction(recordAttributionEventAction, {
    toastOnError: false,
    onSuccess: (data) => {
      toast.success(data.campaignKnown || !form.campaignId ? t.saved : t.unknownCampaign);
      setOpen(false);
      setForm((f) => ({ ...f, campaignId: "", amount: "", externalRef: "", notes: "" }));
      router.refresh();
    },
  });
  const submit = () =>
    run.run({
      type: form.type,
      occurredAt: new Date(`${form.date}T12:00:00Z`).toISOString(),
      ...(form.campaignId.trim() ? { campaignId: form.campaignId.trim() } : {}),
      ...(form.marketId ? { marketId: form.marketId } : {}),
      quantity: Number(form.quantity) || 1,
      ...(form.amount.trim() ? { amount: Number(form.amount.replace(",", ".")) } : {}),
      ...(form.externalRef.trim() ? { externalRef: form.externalRef.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    });
  const err = (field: string) => run.fieldErrors?.[field]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <PlusIcon /> {t.button}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label={t.type} htmlFor="attr-type">
            <select
              id="attr-type"
              className={selectClass}
              value={form.type}
              onChange={(e) => set("type")(e.target.value)}
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {types[type]}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label={t.date} htmlFor="attr-date" error={err("occurredAt")}>
            <Input
              id="attr-date"
              type="date"
              value={form.date}
              onChange={(e) => set("date")(e.target.value)}
            />
          </FieldBlock>
        </div>
        <FieldBlock
          label={t.campaign}
          htmlFor="attr-campaign"
          hint={t.campaignHint}
          error={err("campaignId")}
        >
          <Input
            id="attr-campaign"
            value={form.campaignId}
            onChange={(e) => set("campaignId")(e.target.value)}
          />
        </FieldBlock>
        <FieldBlock
          label={t.market}
          htmlFor="attr-market"
          hint={t.marketHint}
          error={err("marketId")}
        >
          <select
            id="attr-market"
            className={selectClass}
            value={form.marketId}
            onChange={(e) => set("marketId")(e.target.value)}
          >
            <option value="">—</option>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </FieldBlock>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldBlock label={t.quantity} htmlFor="attr-qty" error={err("quantity")}>
            <Input
              id="attr-qty"
              inputMode="numeric"
              value={form.quantity}
              onChange={(e) => set("quantity")(e.target.value)}
            />
          </FieldBlock>
          <FieldBlock
            label={t.amount}
            htmlFor="attr-amount"
            hint={t.amountHint}
            error={err("amount")}
          >
            <Input
              id="attr-amount"
              inputMode="decimal"
              value={form.amount}
              disabled={form.type === "LEAD"}
              onChange={(e) => set("amount")(e.target.value)}
            />
          </FieldBlock>
        </div>
        <FieldBlock label={t.ref} htmlFor="attr-ref" error={err("externalRef")}>
          <Input
            id="attr-ref"
            value={form.externalRef}
            onChange={(e) => set("externalRef")(e.target.value)}
          />
        </FieldBlock>
        <FieldBlock label={t.notes} htmlFor="attr-notes" error={err("notes")}>
          <Input
            id="attr-notes"
            value={form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </FieldBlock>
        {run.error && !run.fieldErrors ? (
          <p role="alert" className="text-sm text-destructive">
            {run.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={submit} disabled={run.pending}>
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportAttributionDialog() {
  const { messages } = useI18n();
  const t = messages.analytics.commercial.import;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const run = useAction(importAttributionCsvAction, {
    toastOnError: false,
    onSuccess: () => {
      setOpen(false);
      setFile(null);
      toast.success(t.started);
      router.refresh();
    },
  });
  const submit = async () => {
    if (!file) return;
    setReading(true);
    try {
      await run.run({ fileName: file.name, text: await file.text() });
    } catch {
      toast.error(t.readError);
    } finally {
      setReading(false);
    }
  };
  const template = () => {
    const url = URL.createObjectURL(new Blob([`﻿${TEMPLATE}`], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "attribution-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <UploadIcon /> {t.button}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FieldBlock
          label={t.file}
          htmlFor="attr-file"
          error={run.fieldErrors?.file?.[0] ?? (run.fieldErrors ? undefined : run.error?.message)}
        >
          <Input
            id="attr-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </FieldBlock>
        <button
          type="button"
          onClick={template}
          className="self-start text-sm text-muted-foreground underline underline-offset-4"
        >
          {t.template}
        </button>
        <DialogFooter>
          <Button onClick={submit} disabled={!file || reading || run.pending}>
            {t.start}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReassignCampaignForm({ from, known }: { from: string; known: string[] }) {
  const { messages } = useI18n();
  const t = messages.analytics.commercial.reconcile;
  const router = useRouter();
  const [to, setTo] = useState("");
  const run = useAction(reassignCampaignAction, {
    toastOnError: false,
    onSuccess: (data) => {
      toast.success(format(t.moved, { n: data.moved }));
      router.refresh();
    },
  });
  const listId = `known-${from}`;
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run.run({ from, to });
      }}
    >
      <div className="flex flex-col gap-1">
        <Input
          aria-label={t.target}
          placeholder={t.target}
          list={listId}
          value={to}
          className="h-8 w-64"
          onChange={(e) => setTo(e.target.value)}
        />
        <datalist id={listId}>
          {known.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        {run.error ? (
          <p role="alert" className="text-xs text-destructive">
            {run.fieldErrors?.to?.[0] ?? run.error.message}
          </p>
        ) : null}
      </div>
      <Button size="sm" type="submit" disabled={!to.trim() || run.pending}>
        {t.move}
      </Button>
    </form>
  );
}

export function DeleteAttributionButton({ id }: { id: string }) {
  const { messages } = useI18n();
  const t = messages.analytics.commercial;
  const router = useRouter();
  const run = useAction(deleteAttributionEventAction, {
    onSuccess: () => {
      toast.success(t.deleted);
      router.refresh();
    },
  });
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={t.delete}
      title={t.delete}
      disabled={run.pending}
      onClick={() => void run.run({ id })}
    >
      <Trash2Icon />
    </Button>
  );
}

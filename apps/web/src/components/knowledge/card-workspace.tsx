"use client";

import { ArchiveIcon, CheckIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RowsEditor } from "@/components/settings/rows-editor";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import {
  type CardFormState,
  cardToForm,
  type EditableCard,
  formToPatch,
  NEW_ROWS,
  TEMPERATURE_TARGETS,
  TEMPERATURE_UNITS,
  TIMING_UNITS,
} from "@/lib/card-form";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { transitionKnowledgeCard, updateKnowledgeCard } from "@/server/actions/knowledge";

export type CardWorkspaceCard = EditableCard & {
  id: string;
  version: number;
  approvedVersion: number | null;
  status: "EXTRACTED" | "NEEDS_REVIEW" | "CHEF_APPROVED" | "ARCHIVED";
  flags: string[];
  language: string;
  archiveReason: string | null;
  /** False when the quote was checked and not found; null for cards without a quote. */
  quoteVerified: boolean | null;
};

const ARCHIVE_REASONS = ["OUT_OF_SCOPE", "INACCURATE", "DUPLICATE", "OTHER"] as const;
const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

function FieldBlock({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The editor of one card with the review actions (approve, archive, restore). Editing an approved
 * card asks first, because saving sends it back to review as the next version.
 */
export function CardWorkspace({
  card,
  categories,
  canApprove,
}: {
  card: CardWorkspaceCard;
  categories: { code: string; label: string }[];
  canApprove: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.card;
  const e = t.editor;
  const router = useRouter();
  const initial = useMemo(() => cardToForm(card), [card]);
  const [form, setForm] = useState<CardFormState>(initial);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [dialog, setDialog] = useState<null | "approve" | "archive" | "restore">(null);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<(typeof ARCHIVE_REASONS)[number]>("OUT_OF_SCOPE");

  const { patch, errors } = useMemo(() => formToPatch(initial, form), [initial, form]);
  const dirty = Object.keys(patch).length > 0 || Object.keys(errors).length > 0;
  const archived = card.status === "ARCHIVED";
  const approved = card.status === "CHEF_APPROVED";
  const set = <K extends keyof CardFormState>(key: K, value: CardFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useAction(updateKnowledgeCard, {
    onSuccess: (updated) => {
      setConfirmEdit(false);
      toast.success(
        approved ? format(t.results.sentToReview, { version: updated.version }) : t.results.saved,
      );
      router.refresh();
    },
  });
  const move = useAction(transitionKnowledgeCard, {
    onSuccess: (result) => {
      setDialog(null);
      setChecked(false);
      setNote("");
      toast.success(
        result.status === "CHEF_APPROVED"
          ? t.results.approved
          : result.status === "ARCHIVED"
            ? t.results.archived
            : t.results.restored,
      );
      router.refresh();
    },
  });

  const submit = () => {
    if (Object.keys(errors).length > 0) return;
    if (approved && !confirmEdit) {
      setConfirmEdit(true);
      return;
    }
    save.run({ id: card.id, version: card.version, patch });
  };
  const categoryOptions = categories.some((c) => c.code === card.category)
    ? categories
    : [{ code: card.category, label: card.category }, ...categories];

  const approveNeedsCheck = card.quoteVerified === false;
  const doApprove = () =>
    move.run({
      id: card.id,
      to: "CHEF_APPROVED",
      ...(approveNeedsCheck ? { acceptUnverifiedQuote: true, note: note.trim() } : {}),
    });

  const disabledApprove = !canApprove || dirty;
  const reasonHint = !canApprove ? t.actions.onlyChef : dirty ? t.actions.saveFirst : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={card.status} label={t.status[card.status]} />
        <Badge variant="outline">{format(t.version, { version: card.version })}</Badge>
        <span className="text-xs text-muted-foreground">
          {card.approvedVersion
            ? format(t.approvedVersion, { version: card.approvedVersion })
            : t.neverApproved}
        </span>
        <span className="flex-1" />
        {card.status === "NEEDS_REVIEW" || card.status === "EXTRACTED" ? (
          <Button
            size="sm"
            disabled={disabledApprove || move.pending}
            title={reasonHint}
            onClick={() => setDialog("approve")}
          >
            <CheckIcon /> {t.actions.approve}
          </Button>
        ) : null}
        {archived ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!canApprove || move.pending}
            title={canApprove ? undefined : t.actions.onlyChef}
            onClick={() => setDialog("restore")}
          >
            <RotateCcwIcon /> {t.actions.restore}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={(approved && !canApprove) || dirty || move.pending}
            title={
              approved && !canApprove ? t.actions.onlyChef : dirty ? t.actions.saveFirst : undefined
            }
            onClick={() => setDialog("archive")}
          >
            <ArchiveIcon /> {t.actions.archive}
          </Button>
        )}
      </div>

      {archived ? <p className="rounded-lg bg-muted px-3 py-2 text-sm">{e.readOnly}</p> : null}

      <form
        className="flex flex-col gap-4"
        lang={card.language}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={archived} className="flex min-w-0 flex-col gap-4">
          <FieldBlock
            label={e.title}
            htmlFor="card-title"
            error={save.fieldErrors?.["patch.title"]?.[0]}
          >
            <Input
              id="card-title"
              value={form.title}
              onChange={(ev) => set("title", ev.target.value)}
            />
          </FieldBlock>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock
              label={e.category}
              htmlFor="card-category"
              error={save.fieldErrors?.["patch.category"]?.[0]}
            >
              <select
                id="card-category"
                className={selectClass}
                value={form.category}
                onChange={(ev) => set("category", ev.target.value)}
              >
                {categoryOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </FieldBlock>
            <FieldBlock label={e.subcategory} htmlFor="card-subcategory">
              <Input
                id="card-subcategory"
                value={form.subcategory}
                onChange={(ev) => set("subcategory", ev.target.value)}
              />
            </FieldBlock>
          </div>
          <FieldBlock
            label={e.claim}
            htmlFor="card-claim"
            error={save.fieldErrors?.["patch.claim"]?.[0]}
          >
            <Textarea
              id="card-claim"
              rows={3}
              value={form.claim}
              onChange={(ev) => set("claim", ev.target.value)}
            />
          </FieldBlock>
          <FieldBlock label={e.explanation} htmlFor="card-explanation">
            <Textarea
              id="card-explanation"
              rows={3}
              value={form.explanation}
              onChange={(ev) => set("explanation", ev.target.value)}
            />
          </FieldBlock>

          <FieldBlock label={e.procedure}>
            <RowsEditor
              rows={form.procedure}
              columns={[{ key: "text", label: e.columns.text }]}
              onChange={(rows) => set("procedure", rows)}
              newRow={NEW_ROWS.procedure}
              disabled={archived}
              addLabel={e.add.procedure}
              emptyLabel={e.none}
              removeLabel={e.removeRow}
            />
          </FieldBlock>
          <FieldBlock label={e.ingredients}>
            <RowsEditor
              rows={form.ingredients}
              columns={[
                { key: "name", label: e.columns.name },
                { key: "quantity", label: e.columns.quantity, width: "w-24" },
                { key: "unit", label: e.columns.unit, width: "w-24" },
                { key: "note", label: e.columns.note },
              ]}
              onChange={(rows) => set("ingredients", rows)}
              newRow={NEW_ROWS.ingredients}
              disabled={archived}
              errorsForRow={(i) => (errors[`ingredients.${i}.quantity`] ? [e.numberRequired] : [])}
              addLabel={e.add.ingredients}
              emptyLabel={e.none}
              removeLabel={e.removeRow}
            />
          </FieldBlock>
          <FieldBlock label={e.temperatures}>
            <RowsEditor
              rows={form.temperatures}
              columns={[
                { key: "value", label: e.columns.value, width: "w-20" },
                { key: "unit", label: e.columns.unit, width: "w-20", options: TEMPERATURE_UNITS },
                {
                  key: "target",
                  label: e.columns.target,
                  width: "w-40",
                  options: TEMPERATURE_TARGETS,
                },
                { key: "context", label: e.columns.context },
              ]}
              onChange={(rows) => set("temperatures", rows)}
              newRow={NEW_ROWS.temperatures}
              disabled={archived}
              errorsForRow={(i) => (errors[`temperatures.${i}.value`] ? [e.numberRequired] : [])}
              addLabel={e.add.temperatures}
              emptyLabel={e.none}
              removeLabel={e.removeRow}
            />
          </FieldBlock>
          <FieldBlock label={e.timings}>
            <RowsEditor
              rows={form.timings}
              columns={[
                { key: "value", label: e.columns.value, width: "w-20" },
                { key: "valueMax", label: e.columns.valueMax, width: "w-20" },
                { key: "unit", label: e.columns.unit, width: "w-20", options: TIMING_UNITS },
                { key: "context", label: e.columns.context },
              ]}
              onChange={(rows) => set("timings", rows)}
              newRow={NEW_ROWS.timings}
              disabled={archived}
              errorsForRow={(i) =>
                [errors[`timings.${i}.value`], errors[`timings.${i}.valueMax`]]
                  .filter(Boolean)
                  .map(() => e.numberRequired)
              }
              addLabel={e.add.timings}
              emptyLabel={e.none}
              removeLabel={e.removeRow}
            />
          </FieldBlock>
          <FieldBlock label={e.commonMistakes}>
            <RowsEditor
              rows={form.commonMistakes}
              columns={[
                { key: "mistake", label: e.columns.mistake },
                { key: "why", label: e.columns.why },
                { key: "fix", label: e.columns.fix },
              ]}
              onChange={(rows) => set("commonMistakes", rows)}
              newRow={NEW_ROWS.commonMistakes}
              disabled={archived}
              addLabel={e.add.commonMistakes}
              emptyLabel={e.none}
              removeLabel={e.removeRow}
            />
          </FieldBlock>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={form.safetySensitive}
              onChange={(ev) => set("safetySensitive", ev.target.checked)}
            />
            {e.safetySensitive}
          </label>
          {form.safetySensitive ? (
            <FieldBlock label={e.safetyNotes} htmlFor="card-safety-notes">
              <Textarea
                id="card-safety-notes"
                rows={2}
                value={form.safetyNotes}
                onChange={(ev) => set("safetyNotes", ev.target.value)}
              />
            </FieldBlock>
          ) : null}
          <FieldBlock label={e.tags} htmlFor="card-tags" hint={e.tagsHint}>
            <Input
              id="card-tags"
              value={form.tags}
              onChange={(ev) => set("tags", ev.target.value)}
            />
          </FieldBlock>
        </fieldset>

        {!archived ? (
          <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
            <Button
              type="submit"
              disabled={!dirty || Object.keys(errors).length > 0 || save.pending}
            >
              {save.pending ? e.saving : e.save}
            </Button>
            <span className={cn("text-sm text-muted-foreground", !dirty && "invisible")}>
              {t.unsaved}
            </span>
          </div>
        ) : null}
      </form>

      <Dialog open={confirmEdit} onOpenChange={setConfirmEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.confirmEdit.title}</DialogTitle>
            <DialogDescription>
              {format(t.confirmEdit.body, {
                next: card.version + 1,
                current: card.approvedVersion ?? card.version,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEdit(false)} disabled={save.pending}>
              {t.confirmEdit.cancel}
            </Button>
            <Button onClick={submit} disabled={save.pending}>
              {t.confirmEdit.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "approve"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.approveDialog.title}</DialogTitle>
            <DialogDescription>
              {approveNeedsCheck
                ? t.approveDialog.unverifiedBody
                : format(t.approveDialog.body, { version: card.version })}
            </DialogDescription>
          </DialogHeader>
          {approveNeedsCheck ? (
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={checked}
                  onChange={(ev) => setChecked(ev.target.checked)}
                />
                {t.approveDialog.checked}
              </label>
              <FieldBlock
                label={t.approveDialog.note}
                htmlFor="approve-note"
                error={move.fieldErrors?.note?.[0]}
              >
                <Textarea
                  id="approve-note"
                  rows={2}
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                />
              </FieldBlock>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={move.pending}>
              {t.approveDialog.cancel}
            </Button>
            <Button
              onClick={doApprove}
              disabled={move.pending || (approveNeedsCheck && (!checked || note.trim() === ""))}
            >
              {t.approveDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "archive"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.archiveDialog.title}</DialogTitle>
            <DialogDescription>{t.archiveDialog.description}</DialogDescription>
          </DialogHeader>
          <FieldBlock label={t.archiveDialog.reason} htmlFor="archive-reason">
            <select
              id="archive-reason"
              className={selectClass}
              value={reason}
              onChange={(ev) => setReason(ev.target.value as typeof reason)}
            >
              {ARCHIVE_REASONS.map((value) => (
                <option key={value} value={value}>
                  {messages.cards.archiveDialog.reasons[value]}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label={t.archiveDialog.note} htmlFor="archive-note">
            <Textarea
              id="archive-note"
              rows={2}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
          </FieldBlock>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={move.pending}>
              {t.archiveDialog.cancel}
            </Button>
            <Button
              disabled={move.pending}
              onClick={() =>
                move.run({
                  id: card.id,
                  to: "ARCHIVED",
                  archiveReason: reason,
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              }
            >
              {t.archiveDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "restore"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.restoreDialog.title}</DialogTitle>
            <DialogDescription>{t.restoreDialog.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={move.pending}>
              {t.restoreDialog.cancel}
            </Button>
            <Button
              disabled={move.pending}
              onClick={() => move.run({ id: card.id, to: "NEEDS_REVIEW" })}
            >
              {t.restoreDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STATUS_STYLE: Record<CardWorkspaceCard["status"], string> = {
  EXTRACTED: "bg-muted text-muted-foreground",
  NEEDS_REVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  CHEF_APPROVED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  ARCHIVED: "bg-muted text-muted-foreground line-through",
};

function StatusBadge({ status, label }: { status: CardWorkspaceCard["status"]; label: string }) {
  return (
    <Badge variant="ghost" className={STATUS_STYLE[status]}>
      {label}
    </Badge>
  );
}

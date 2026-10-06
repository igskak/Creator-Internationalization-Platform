"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
import { RowsEditor } from "@/components/settings/rows-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import {
  type CardFormState,
  cardToForm,
  formToPatch,
  NEW_ROWS,
  TEMPERATURE_TARGETS,
  TEMPERATURE_UNITS,
  TIMING_UNITS,
} from "@/lib/card-form";
import { useI18n } from "@/lib/i18n/provider";
import { createManualKnowledgeCard } from "@/server/actions/knowledge";

const LANGUAGES = ["ru", "en", "uk"] as const;

/** An empty card, so that `formToPatch` returns exactly what the author filled in. */
const EMPTY = cardToForm({
  title: "",
  category: "",
  subcategory: null,
  claim: "",
  explanation: "",
  procedureJson: [],
  ingredientsJson: [],
  temperaturesJson: [],
  timingsJson: [],
  commonMistakesJson: [],
  safetySensitive: false,
  safetyNotes: null,
  tags: [],
});

/** The form of a card written by hand (M1-20). The new card goes to review. */
export function NewCardForm({
  categories,
  defaultLanguage,
}: {
  categories: { code: string; label: string }[];
  defaultLanguage: string;
}) {
  const { locale, messages } = useI18n();
  const t = messages.newCard;
  const e = messages.card.editor;
  const router = useRouter();
  const [form, setForm] = useState<CardFormState>({
    ...EMPTY,
    category: categories[0]?.code ?? "",
  });
  const [language, setLanguage] = useState(defaultLanguage);
  const { patch, errors } = useMemo(() => formToPatch(EMPTY, form), [form]);
  const set = <K extends keyof CardFormState>(key: K, value: CardFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const names = useMemo(() => new Intl.DisplayNames(locale, { type: "language" }), [locale]);

  const create = useAction(createManualKnowledgeCard, {
    successMessage: t.created,
    onSuccess: (card) => router.push(`/knowledge/cards/${card.id}`),
  });
  const invalid = Object.keys(errors).length > 0 || !form.title.trim() || !form.claim.trim();

  return (
    <form
      className="flex max-w-3xl flex-col gap-4"
      lang={language}
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid) return;
        create.run({
          ...patch,
          title: form.title,
          claim: form.claim,
          category: form.category,
          language,
        } as Parameters<typeof create.run>[0]);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock
          label={t.category}
          htmlFor="new-category"
          error={create.fieldErrors?.category?.[0]}
        >
          <select
            id="new-category"
            className={selectClass}
            value={form.category}
            onChange={(ev) => set("category", ev.target.value)}
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </FieldBlock>
        <FieldBlock
          label={t.language}
          htmlFor="new-language"
          hint={t.languageHint}
          error={create.fieldErrors?.language?.[0]}
        >
          <select
            id="new-language"
            className={selectClass}
            value={language}
            onChange={(ev) => setLanguage(ev.target.value)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {names.of(code) ?? code}
              </option>
            ))}
          </select>
        </FieldBlock>
      </div>
      <FieldBlock label={e.title} htmlFor="new-title" error={create.fieldErrors?.title?.[0]}>
        <Input id="new-title" value={form.title} onChange={(ev) => set("title", ev.target.value)} />
      </FieldBlock>
      <FieldBlock label={e.subcategory} htmlFor="new-subcategory">
        <Input
          id="new-subcategory"
          value={form.subcategory}
          onChange={(ev) => set("subcategory", ev.target.value)}
        />
      </FieldBlock>
      <FieldBlock label={e.claim} htmlFor="new-claim" error={create.fieldErrors?.claim?.[0]}>
        <Textarea
          id="new-claim"
          rows={3}
          value={form.claim}
          onChange={(ev) => set("claim", ev.target.value)}
        />
      </FieldBlock>
      <FieldBlock label={e.explanation} htmlFor="new-explanation">
        <Textarea
          id="new-explanation"
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
            { key: "target", label: e.columns.target, width: "w-40", options: TEMPERATURE_TARGETS },
            { key: "context", label: e.columns.context },
          ]}
          onChange={(rows) => set("temperatures", rows)}
          newRow={NEW_ROWS.temperatures}
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
        <FieldBlock label={e.safetyNotes} htmlFor="new-safety-notes">
          <Textarea
            id="new-safety-notes"
            rows={2}
            value={form.safetyNotes}
            onChange={(ev) => set("safetyNotes", ev.target.value)}
          />
        </FieldBlock>
      ) : null}
      <FieldBlock label={e.tags} htmlFor="new-tags" hint={e.tagsHint}>
        <Input id="new-tags" value={form.tags} onChange={(ev) => set("tags", ev.target.value)} />
      </FieldBlock>

      <div className="flex items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={invalid || create.pending}>
          {create.pending ? t.creating : t.create}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/knowledge/cards")}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

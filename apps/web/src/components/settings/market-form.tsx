"use client";

import type { ForbiddenPattern, VisualHypothesis, VocabularyEntry } from "@rc/db/json";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { updateMarket } from "@/server/actions/settings";
import { errorsFor, FieldErrorText } from "./field-errors";
import { type RowColumn, RowsEditor } from "./rows-editor";

export type MarketFormValues = {
  id: string;
  code: string;
  displayName: string;
  timezone: string;
  measurementSystem: "METRIC" | "IMPERIAL" | "DUAL";
  isActive: boolean;
  toneNotes: string;
  foodCultureNotes: string;
  preferredVocabulary: VocabularyEntry[];
  forbiddenPatterns: ForbiddenPattern[];
  visualHypotheses: VisualHypothesis[];
};

type VocabRow = { concept: string; preferred: string; avoid: string; note: string };
type PatternRow = { pattern: string; kind: string; reason: string };
type HypothesisRow = {
  id: string;
  description: string;
  visualStyle: string;
  themeVariant: string;
  status: string;
};

const toVocabRows = (list: VocabularyEntry[]): VocabRow[] =>
  list.map((v) => ({
    concept: v.concept,
    preferred: v.preferred,
    avoid: (v.avoid ?? []).join(", "),
    note: v.note ?? "",
  }));
const fromVocabRows = (rows: VocabRow[]): VocabularyEntry[] =>
  rows.map((r) => {
    const avoid = r.avoid
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      concept: r.concept.trim(),
      preferred: r.preferred.trim(),
      ...(avoid.length ? { avoid } : {}),
      ...(r.note.trim() ? { note: r.note.trim() } : {}),
    };
  });

const toHypothesisRows = (list: VisualHypothesis[]): HypothesisRow[] =>
  list.map((h) => ({ ...h, themeVariant: h.themeVariant ?? "" }));
const fromHypothesisRows = (rows: HypothesisRow[]): VisualHypothesis[] =>
  rows.map((r) => ({
    id: r.id,
    description: r.description.trim(),
    visualStyle: r.visualStyle,
    ...(r.themeVariant.trim() ? { themeVariant: r.themeVariant.trim() } : {}),
    status: r.status as VisualHypothesis["status"],
  }));

function regexProblem(pattern: string, row: PatternRow): string | null {
  if (row.kind !== "REGEX" || pattern === "") return null;
  try {
    new RegExp(pattern, "iu");
    return null;
  } catch {
    return "Invalid regular expression";
  }
}

/** Market profile editor (05 §5.2 updateMarket). Owners and editors edit; only owners (de)activate. */
export function MarketForm({
  market,
  visualStyles,
  canEdit,
  canActivate,
}: {
  market: MarketFormValues;
  visualStyles: string[];
  canEdit: boolean;
  canActivate: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(market);
  const [vocab, setVocab] = useState(() => toVocabRows(market.preferredVocabulary));
  const [patterns, setPatterns] = useState<PatternRow[]>(() =>
    market.forbiddenPatterns.map((p) => ({ ...p })),
  );
  const [hypotheses, setHypotheses] = useState(() => toHypothesisRows(market.visualHypotheses));
  const { run, pending, fieldErrors } = useAction(updateMarket, {
    successMessage: "Market saved",
    onSuccess: () => router.refresh(),
  });
  const disabled = !canEdit || pending;

  const hypothesisColumns: RowColumn<HypothesisRow>[] = [
    {
      key: "description",
      label: "Hypothesis",
      placeholder: "Warm tones perform better",
      width: "min-w-56 flex-[2]",
    },
    { key: "visualStyle", label: "Visual style", options: visualStyles, width: "w-48" },
    {
      key: "themeVariant",
      label: "Theme variant",
      placeholder: "warm-mediterranean",
      width: "w-44",
    },
    {
      key: "status",
      label: "Status",
      options: ["UNTESTED", "TESTING", "CONFIRMED", "REJECTED"],
      width: "w-36",
    },
  ];

  function save() {
    void run({
      marketId: values.id,
      displayName: values.displayName,
      timezone: values.timezone,
      measurementSystem: values.measurementSystem,
      toneNotes: values.toneNotes,
      foodCultureNotes: values.foodCultureNotes,
      preferredVocabulary: fromVocabRows(vocab),
      forbiddenPatterns: patterns.map((p) => ({
        pattern: p.pattern,
        kind: p.kind as ForbiddenPattern["kind"],
        reason: p.reason,
      })),
      visualHypotheses: fromHypothesisRows(hypotheses),
      ...(canActivate && values.isActive !== market.isActive ? { isActive: values.isActive } : {}),
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            Code <span className="font-mono">{market.code}</span>. Units and time zone are used for
            formatting and scheduling.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={values.displayName}
              disabled={disabled}
              onChange={(e) => setValues({ ...values, displayName: e.target.value })}
            />
            <FieldErrorText messages={errorsFor(fieldErrors, "displayName")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">Time zone (IANA)</Label>
            <Input
              id="timezone"
              value={values.timezone}
              disabled={disabled}
              onChange={(e) => setValues({ ...values, timezone: e.target.value })}
            />
            <FieldErrorText messages={errorsFor(fieldErrors, "timezone")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="measurementSystem">Units</Label>
            <select
              id="measurementSystem"
              value={values.measurementSystem}
              disabled={disabled}
              onChange={(e) =>
                setValues({
                  ...values,
                  measurementSystem: e.target.value as MarketFormValues["measurementSystem"],
                })
              }
              className="h-8 rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="METRIC">Metric</option>
              <option value="IMPERIAL">Imperial</option>
              <option value="DUAL">Dual (imperial first, metric in brackets)</option>
            </select>
          </div>
          <label htmlFor="isActive" className="flex items-center gap-2 self-end text-sm">
            <input
              id="isActive"
              type="checkbox"
              checked={values.isActive}
              disabled={!canActivate || pending}
              onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
            />
            Active market {canActivate ? "" : "(owner only)"}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tone and food culture</CardTitle>
          <CardDescription>Used by the market adapter and the writer prompts.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="toneNotes">Tone notes</Label>
            <Textarea
              id="toneNotes"
              rows={8}
              value={values.toneNotes}
              disabled={disabled}
              onChange={(e) => setValues({ ...values, toneNotes: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="foodCultureNotes">Food culture notes</Label>
            <Textarea
              id="foodCultureNotes"
              rows={8}
              value={values.foodCultureNotes}
              disabled={disabled}
              onChange={(e) => setValues({ ...values, foodCultureNotes: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferred vocabulary</CardTitle>
          <CardDescription>Local terms to use; "avoid" is comma-separated.</CardDescription>
        </CardHeader>
        <CardContent>
          <RowsEditor
            rows={vocab}
            onChange={setVocab}
            disabled={disabled}
            addLabel="Add term"
            newRow={() => ({ concept: "", preferred: "", avoid: "", note: "" })}
            errorsForRow={(i) => errorsFor(fieldErrors, `preferredVocabulary.${i}`, true)}
            columns={[
              { key: "concept", label: "Concept", placeholder: "shrimp" },
              { key: "preferred", label: "Preferred", placeholder: "gamba" },
              { key: "avoid", label: "Avoid", placeholder: "camarón" },
              { key: "note", label: "Note" },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forbidden patterns</CardTitle>
          <CardDescription>
            Phrases or regular expressions (case-insensitive) the validators flag.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RowsEditor
            rows={patterns}
            onChange={setPatterns}
            disabled={disabled}
            addLabel="Add pattern"
            newRow={() => ({ pattern: "", kind: "PHRASE", reason: "" })}
            errorsForRow={(i) => errorsFor(fieldErrors, `forbiddenPatterns.${i}`, true)}
            columns={[
              {
                key: "pattern",
                label: "Pattern",
                placeholder: "\\bcamar[oó]n\\b",
                validate: regexProblem,
                width: "min-w-56 flex-[2]",
              },
              { key: "kind", label: "Kind", options: ["PHRASE", "REGEX"], width: "w-28" },
              { key: "reason", label: "Reason", placeholder: "Latin American term" },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visual hypotheses</CardTitle>
          <CardDescription>
            What we expect to work visually in this market (spec §8.2).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RowsEditor
            rows={hypotheses}
            onChange={setHypotheses}
            disabled={disabled}
            addLabel="Add hypothesis"
            newRow={() => ({
              id: crypto.randomUUID(),
              description: "",
              visualStyle: visualStyles[0] ?? "",
              themeVariant: "",
              status: "UNTESTED",
            })}
            errorsForRow={(i) => errorsFor(fieldErrors, `visualHypotheses.${i}`, true)}
            columns={hypothesisColumns}
          />
        </CardContent>
      </Card>

      {canEdit ? (
        <div className="sticky bottom-0 flex justify-end border-t bg-background py-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save market"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Read-only: owners and editors can edit market profiles.
        </p>
      )}
    </form>
  );
}

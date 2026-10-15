"use client";

import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { countChars } from "./count-chars";
import { RegeneratePopover } from "./regenerate-popover";
import { RegenerationDiff } from "./regeneration-diff";
import { useEditField } from "./use-edit-field";
import { fieldDomId, useVariant } from "./variant-state";

/** A text field of the draft with edit (✎) and regenerate (↻), a counter and a limit (plan 10 §10.3). */
export function EditableText({
  path,
  label,
  fieldLabel,
  value,
  lang,
  maxChars,
  maxLines,
  required,
  rows = 2,
  className,
  textClassName,
  regenerate = true,
}: {
  path: string;
  /** Label of the input and of the buttons, e.g. "Hook". */
  label: string;
  /** For messages: "hook", "caption of slide 2" … */
  fieldLabel: string;
  value: string;
  lang?: string;
  maxChars?: number;
  maxLines?: number;
  required?: boolean;
  rows?: number;
  className?: string;
  textClassName?: string;
  /** Offer ↻ (a field the field editor can redo); a Reel's caption is edited by hand only. */
  regenerate?: boolean;
}) {
  const t = useI18n().messages.review.edit;
  const variant = useVariant();
  const { save, pending, error, warnings } = useEditField();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const count = countChars(draft);
  const over = maxChars !== undefined && count > maxChars;
  const empty = required === true && draft.trim() === "";
  const unchanged = draft === value;
  const blocked = variant.editBlocker !== null;

  const submit = async () => {
    if (await save(path, draft)) setEditing(false);
  };

  return (
    <div
      id={fieldDomId(variant.variantId, path)}
      data-field={path}
      className={cn("flex flex-col gap-1.5", className)}
    >
      {editing ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Textarea
            aria-label={label}
            aria-invalid={over || empty || Boolean(error)}
            lang={lang}
            rows={rows}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className={cn("tabular-nums", over && "font-medium text-destructive")}>
              {maxChars !== undefined
                ? format(t.count, { count, max: maxChars })
                : format(t.count, { count, max: "—" })}
              {over && maxChars !== undefined
                ? ` · ${format(t.over, { count: count - maxChars })}`
                : ""}
              {maxLines !== undefined ? ` · ${format(t.lines, { lines: maxLines })}` : ""}
              {required ? ` · ${t.required}` : ""}
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setDraft(value);
                  setEditing(false);
                }}
              >
                {t.cancel}
              </Button>
              <Button type="submit" size="xs" disabled={pending || over || empty || unchanged}>
                {pending ? t.saving : t.save}
              </Button>
            </span>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p lang={lang} className={cn("min-w-0 whitespace-pre-line", textClassName)}>
            {value || <span className="text-muted-foreground">—</span>}
          </p>
          <span className="flex flex-none">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={blocked}
              title={variant.editBlocker ?? undefined}
              aria-label={`${t.edit}: ${fieldLabel}`}
              onClick={() => {
                setDraft(value);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </Button>
            {regenerate ? <RegeneratePopover path={path} fieldLabel={fieldLabel} /> : null}
          </span>
        </div>
      )}
      {warnings.length > 0 ? (
        <ul className="text-xs text-amber-700 dark:text-amber-300">
          {warnings.map((warning) => (
            <li key={`${warning.code}-${warning.fieldPath}`}>{warning.message}</li>
          ))}
        </ul>
      ) : null}
      <RegenerationDiff path={path} />
    </div>
  );
}

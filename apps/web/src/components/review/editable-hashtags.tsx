"use client";

import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { RegeneratePopover } from "./regenerate-popover";
import { RegenerationDiff } from "./regeneration-diff";
import { useEditField } from "./use-edit-field";
import { fieldDomId, useVariant } from "./variant-state";

const split = (text: string) => text.split(/\s+/).filter(Boolean);

/** The hashtags: badges, with an input that takes them separated by spaces. */
export function EditableHashtags({
  value,
  regenerate = true,
}: {
  value: string[];
  /** Offer ↻; a Reel's hashtags are edited by hand only. */
  regenerate?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.review.edit;
  const variant = useVariant();
  const { save, pending, error, warnings } = useEditField();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.join(" "));
  const tags = split(draft);

  return (
    <div
      id={fieldDomId(variant.variantId, "hashtags")}
      data-field="hashtags"
      className="flex flex-col gap-1.5"
    >
      {editing ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save("hashtags", tags).then((ok) => ok && setEditing(false));
          }}
        >
          <Input
            aria-label={messages.review.hashtags}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{format(t.hashtagsHint, { count: tags.length })}</span>
            <span className="flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setDraft(value.join(" "));
                  setEditing(false);
                }}
              >
                {t.cancel}
              </Button>
              <Button
                type="submit"
                size="xs"
                disabled={pending || draft.trim() === value.join(" ")}
              >
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
          <p className="flex flex-wrap gap-1.5">
            {value.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </p>
          <span className="flex flex-none">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={variant.editBlocker !== null}
              title={variant.editBlocker ?? undefined}
              aria-label={`${t.edit}: ${t.field.hashtags}`}
              onClick={() => {
                setDraft(value.join(" "));
                setEditing(true);
              }}
            >
              <PencilIcon />
            </Button>
            {regenerate ? (
              <RegeneratePopover path="hashtags" fieldLabel={t.field.hashtags} />
            ) : null}
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
      <RegenerationDiff path="hashtags" />
    </div>
  );
}

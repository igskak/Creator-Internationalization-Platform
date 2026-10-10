"use client";

import type { CtaSpec } from "@rc/db/json";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { RegeneratePopover } from "./regenerate-popover";
import { RegenerationDiff } from "./regeneration-diff";
import { useEditField } from "./use-edit-field";
import { fieldDomId, useVariant } from "./variant-state";

const KEYWORD_TYPES = new Set(["COMMENT_KEYWORD", "DM_KEYWORD"]);

/** The call to action: type, text and, for keyword types, the ManyChat keyword. */
export function EditableCta({
  cta,
  ctaTypes,
  offerName,
}: {
  cta: CtaSpec | null;
  ctaTypes: { code: string; label: string }[];
  offerName: string | null;
}) {
  const { messages } = useI18n();
  const t = messages.review.edit;
  const variant = useVariant();
  const { save, pending, error } = useEditField();
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(cta?.type ?? "");
  const [text, setText] = useState(cta?.text ?? "");
  const [keyword, setKeyword] = useState(cta?.keyword ?? "");
  const needsKeyword = KEYWORD_TYPES.has(type);

  const reset = () => {
    setType(cta?.type ?? "");
    setText(cta?.text ?? "");
    setKeyword(cta?.keyword ?? "");
  };
  const value: CtaSpec = {
    ...(cta ?? {}),
    type,
    text,
    ...(needsKeyword && keyword ? { keyword } : {}),
  };
  if (!needsKeyword) delete value.keyword;

  return (
    <div
      id={fieldDomId(variant.variantId, "cta")}
      data-field="cta"
      className="flex flex-col gap-1.5"
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save("cta", value).then((ok) => ok && setEditing(false));
          }}
        >
          <FieldBlock label={t.cta.type} htmlFor="cta-type">
            <select
              id="cta-type"
              className={selectClass}
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {ctaTypes.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </FieldBlock>
          <FieldBlock label={t.cta.text} htmlFor="cta-text">
            <Input id="cta-text" value={text} onChange={(event) => setText(event.target.value)} />
          </FieldBlock>
          {needsKeyword ? (
            <FieldBlock label={t.cta.keyword} htmlFor="cta-keyword">
              <Input
                id="cta-keyword"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value.toUpperCase())}
              />
            </FieldBlock>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => {
                reset();
                setEditing(false);
              }}
            >
              {t.cancel}
            </Button>
            <Button type="submit" size="xs" disabled={pending || !type || !text.trim()}>
              {pending ? t.saving : t.save}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p>
            <span className="font-mono text-xs">{cta?.type}</span> · {cta?.text}
            {cta?.keyword ? (
              <span className="text-muted-foreground">
                {" "}
                ({format(messages.review.ctaKeyword, { keyword: cta.keyword })})
              </span>
            ) : null}
          </p>
          <span className="flex flex-none">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={variant.editBlocker !== null}
              title={variant.editBlocker ?? undefined}
              aria-label={`${t.edit}: ${t.field.cta}`}
              onClick={() => {
                reset();
                setEditing(true);
              }}
            >
              <PencilIcon />
            </Button>
            <RegeneratePopover path="cta" fieldLabel={t.field.cta} />
          </span>
        </div>
      )}
      {offerName ? (
        <p className="text-xs text-muted-foreground">
          {messages.review.idea.offer}: {offerName}
        </p>
      ) : null}
      <RegenerationDiff path="cta" />
    </div>
  );
}

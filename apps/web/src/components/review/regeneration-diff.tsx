"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { useEditField } from "./use-edit-field";
import { useVariant } from "./variant-state";

const keptKey = (eventId: string) => `rc-kept-${eventId}`;

/** A short text for any field value (string, hashtags, CTA, slide, picture plan). */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(" ");
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.prompt === "string") return v.prompt;
    if (v.slots && typeof v.slots === "object") return Object.values(v.slots).join(" · ");
    if (typeof v.text === "string") return v.type ? `${v.type}: ${v.text}` : v.text;
  }
  return JSON.stringify(value);
}

/**
 * Old versus new after a regeneration (plan 10 §10.3). Keep hides the box on this device; Undo is
 * a normal edit back to the old value (so it is recorded like any other edit). A picture cannot be
 * undone this way (its old picture is kept by the plan, not by the field), so it only offers Keep.
 */
export function RegenerationDiff({ path }: { path: string }) {
  const t = useI18n().messages.review.edit;
  const variant = useVariant();
  const pending = variant.regenerations.get(path);
  const { save, pending: saving } = useEditField();
  const [kept, setKept] = useState(false);
  const eventId = pending?.reviewEventId;

  useEffect(() => {
    if (!eventId) return;
    try {
      setKept(localStorage.getItem(keptKey(eventId)) === "1");
    } catch {
      setKept(false);
    }
  }, [eventId]);

  if (!pending || kept) return null;
  const isPicture = path.includes(".images.");
  const keep = () => {
    try {
      localStorage.setItem(keptKey(pending.reviewEventId), "1");
    } catch {
      // Without storage the box simply stays until the next edit.
    }
    setKept(true);
  };
  const undo = async () => {
    if (await save(path, pending.original, { quiet: true })) toast.success(t.pending.undone);
  };

  return (
    <section
      aria-label={t.pending.title}
      data-testid="regeneration-diff"
      className="flex flex-col gap-1.5 rounded-md border border-dashed bg-muted/40 p-2 text-sm"
    >
      <p className="text-xs font-medium text-muted-foreground">{t.pending.title}</p>
      <p className="text-muted-foreground line-through decoration-1">
        <span className="font-medium no-underline">{t.pending.was}: </span>
        {describeValue(pending.original)}
      </p>
      <p>
        <span className="font-medium">{t.pending.now}: </span>
        {describeValue(pending.edited)}
      </p>
      {isPicture ? <p className="text-xs text-muted-foreground">{t.pending.image}</p> : null}
      <div className="flex gap-2">
        <Button type="button" size="xs" variant="outline" onClick={keep}>
          {t.pending.keep}
        </Button>
        {isPicture ? null : (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={saving || variant.editBlocker !== null}
            onClick={() => void undo()}
          >
            {t.pending.undo}
          </Button>
        )}
      </div>
    </section>
  );
}

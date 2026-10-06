"use client";

import { LanguagesIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { useI18n } from "@/lib/i18n/provider";
import { requestCardGlossAction } from "@/server/actions/knowledge";

export type GlossView = {
  title: string;
  claim: string;
  explanation: string;
  stale: boolean;
};

/**
 * The English reading aid of a card (M1-24). It is always labelled "not approved text" and shown
 * apart from the card, never as something that can be edited or approved.
 */
export function GlossPanel({ cardId, initial }: { cardId: string; initial: GlossView | null }) {
  const t = useI18n().messages.card.gloss;
  const [gloss, setGloss] = useState<GlossView | null>(initial);
  const run = useAction(requestCardGlossAction, { onSuccess: (result) => setGloss(result.gloss) });
  const fields = [
    ["title", gloss?.title],
    ["claim", gloss?.claim],
    ["explanation", gloss?.explanation],
  ] as const;

  return (
    <section aria-labelledby="gloss-title" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="gloss-title" className="text-base font-medium">
          {t.title}
        </h2>
        <Badge variant="outline">{t.label}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t.hint}</p>
      {gloss ? (
        <dl lang="en" className="flex flex-col gap-2 text-sm">
          {fields
            .filter(([, value]) => value)
            .map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-muted-foreground">{t.fields[key]}</dt>
                <dd className="italic">{value}</dd>
              </div>
            ))}
        </dl>
      ) : null}
      {gloss?.stale ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t.stale}</p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={run.pending}
        onClick={() => run.run({ id: cardId, refresh: gloss !== null })}
      >
        <LanguagesIcon /> {run.pending ? t.working : gloss ? t.refresh : t.button}
      </Button>
    </section>
  );
}

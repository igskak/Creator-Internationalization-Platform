"use client";

import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { format, plural } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { generateIdeas, getIdeasRequest } from "@/server/actions/content";

const INTENTS = ["NONE", "LEAD_MAGNET", "PRODUCT_SALE", "NURTURE"] as const;
const POLL_MS = 2_500;
/** The job has a 20 minute budget; the screen stops waiting after 5 and says where to look. */
const GIVE_UP_MS = 5 * 60_000;

type Term = { code: string; label: string };
type Phase =
  | { name: "form" }
  | { name: "running" }
  | { name: "done"; created: number; dropped: number; skipped: number }
  | { name: "failed"; reason: string }
  | { name: "timeout" };

function Toggles({
  terms,
  selected,
  onToggle,
}: {
  terms: Term[];
  selected: string[];
  onToggle: (code: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((term) => {
        const on = selected.includes(term.code);
        return (
          <button
            key={term.code}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(term.code)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-sm transition-colors hover:bg-muted",
              on && "border-foreground/40 bg-muted font-medium",
            )}
          >
            {term.label}
          </button>
        );
      })}
    </div>
  );
}

/** "Generate ideas" (plan 10 §10.2): asks for ideas, waits for the job, and shows what it did. */
export function GenerateIdeasDialog({
  categories,
  angles,
  products,
}: {
  categories: Term[];
  angles: Term[];
  products: { id: string; name: string }[];
}) {
  const { locale, messages } = useI18n();
  const t = messages.ideas.generateDialog;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "form" });
  const [count, setCount] = useState(5);
  const [pickedCategories, setPickedCategories] = useState<string[]>([]);
  const [pickedAngles, setPickedAngles] = useState<string[]>([]);
  const [productId, setProductId] = useState("");
  const [intent, setIntent] = useState<(typeof INTENTS)[number]>("NONE");
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const stopped = useRef(false);

  const queue = useAction(generateIdeas, {
    onSuccess: (data) => {
      setRequestId(data.requestId);
      setPhase({ name: "running" });
    },
    toastOnError: false,
  });
  const check = useAction(getIdeasRequest, { toastOnError: false });
  const checkRef = useRef(check.run);
  checkRef.current = check.run;

  // Poll until the job has written its outcome.
  useEffect(() => {
    if (phase.name !== "running" || !requestId) return;
    stopped.current = false;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (stopped.current) return;
      const result = await checkRef.current({ requestId });
      if (stopped.current || !result.ok || result.data.state === "PENDING") {
        if (Date.now() - startedAt > GIVE_UP_MS) {
          stopped.current = true;
          setPhase({ name: "timeout" });
        }
        return;
      }
      stopped.current = true;
      const { outcome } = result.data;
      if (result.data.state === "FAILED") {
        setPhase({ name: "failed", reason: outcome.reason ?? "" });
      } else {
        setPhase({
          name: "done",
          created: outcome.created.length,
          dropped: outcome.dropped,
          skipped: outcome.skipped,
        });
        router.refresh();
      }
    }, POLL_MS);
    return () => {
      stopped.current = true;
      clearInterval(timer);
    };
  }, [phase.name, requestId, router]);

  const toggle = (list: string[], set: (next: string[]) => void) => (code: string) =>
    set(list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  const reset = () => {
    setPhase({ name: "form" });
    setRequestId(null);
  };
  const submit = () => {
    const focus = {
      ...(pickedCategories.length ? { categories: pickedCategories } : {}),
      ...(pickedAngles.length ? { angles: pickedAngles } : {}),
      ...(productId ? { productId } : {}),
      ...(intent !== "NONE" ? { commercialIntent: intent } : {}),
    };
    void queue.run({
      count,
      ...(Object.keys(focus).length ? { focus } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing after a result starts a fresh form; closing while it works just stops watching.
        setOpen(next);
        if (!next && phase.name !== "form") reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <SparklesIcon /> {messages.ideas.generate}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        {phase.name === "form" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <FieldBlock label={t.count} htmlFor="gen-count" error={queue.fieldErrors?.count?.[0]}>
              <Input
                id="gen-count"
                type="number"
                min={1}
                max={10}
                value={count}
                className="w-24"
                onChange={(ev) => setCount(Math.min(10, Math.max(1, Number(ev.target.value) || 1)))}
              />
            </FieldBlock>
            <FieldBlock label={t.categories} hint={t.categoriesHint}>
              <Toggles
                terms={categories}
                selected={pickedCategories}
                onToggle={toggle(pickedCategories, setPickedCategories)}
              />
            </FieldBlock>
            <FieldBlock label={t.angles} hint={t.anglesHint}>
              <Toggles
                terms={angles}
                selected={pickedAngles}
                onToggle={toggle(pickedAngles, setPickedAngles)}
              />
            </FieldBlock>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldBlock label={t.product} htmlFor="gen-product">
                <select
                  id="gen-product"
                  className={selectClass}
                  value={productId}
                  onChange={(ev) => setProductId(ev.target.value)}
                >
                  <option value="">{t.productNone}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </FieldBlock>
              <FieldBlock label={t.intent} htmlFor="gen-intent">
                <select
                  id="gen-intent"
                  className={selectClass}
                  value={intent}
                  onChange={(ev) => setIntent(ev.target.value as typeof intent)}
                >
                  {INTENTS.map((value) => (
                    <option key={value} value={value}>
                      {messages.ideas.intent[value]}
                    </option>
                  ))}
                </select>
              </FieldBlock>
            </div>
            <FieldBlock label={t.note} htmlFor="gen-note" error={queue.fieldErrors?.note?.[0]}>
              <Textarea
                id="gen-note"
                rows={2}
                maxLength={500}
                placeholder={t.notePlaceholder}
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
              />
            </FieldBlock>
            {queue.error ? (
              <p role="alert" className="text-sm text-destructive">
                {queue.error.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={queue.pending}>
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-3" aria-live="polite">
            {phase.name === "running" ? (
              <p className="text-sm text-muted-foreground">{t.running}</p>
            ) : null}
            {phase.name === "done" ? (
              <>
                <p className="text-sm">
                  {phase.created > 0 ? plural(locale, t.done, phase.created) : t.doneNone}
                </p>
                {phase.dropped > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {format(t.droppedNote, { dropped: phase.dropped })}
                  </p>
                ) : null}
                {phase.skipped > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {format(t.skippedNote, { skipped: phase.skipped })}
                  </p>
                ) : null}
              </>
            ) : null}
            {phase.name === "failed" ? (
              <p role="alert" className="text-sm text-destructive">
                {format(t.failed, { reason: phase.reason })}
              </p>
            ) : null}
            {phase.name === "timeout" ? <p className="text-sm">{t.timeout}</p> : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t.close}
              </Button>
              {phase.name === "failed" ? <Button onClick={reset}>{t.submit}</Button> : null}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

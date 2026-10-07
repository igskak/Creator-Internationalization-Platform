"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { createManualIdea, searchIdeaCards, updateIdea } from "@/server/actions/content";

const INTENTS = ["NONE", "LEAD_MAGNET", "PRODUCT_SALE", "NURTURE"] as const;
type Intent = (typeof INTENTS)[number];
type Role = "PRIMARY" | "SUPPORTING";
type Term = { code: string; label: string };
type Linked = { id: string; role: Role; title: string };
type Choice = {
  id: string;
  title: string;
  claim: string;
  category: string;
  language: string;
  version: number;
};

export type IdeaFormInitial = {
  id: string;
  topic: string;
  category: string;
  angle: string;
  coreMessage: string;
  intent: Intent;
  productId: string | null;
  cards: Linked[];
};

const sameCards = (a: Linked[], b: Linked[]) =>
  a.length === b.length &&
  [...a]
    .sort((x, y) => x.id.localeCompare(y.id))
    .every((card, i) => {
      const other = [...b].sort((x, y) => x.id.localeCompare(y.id))[i];
      return other?.id === card.id && other.role === card.role;
    });

/** The form of a manual idea (new and edit): taxonomy, offer and a picker of approved cards. */
export function IdeaForm({
  mode,
  categories,
  angles,
  products,
  initial,
}: {
  mode: "create" | "edit";
  categories: Term[];
  angles: Term[];
  products: { id: string; name: string }[];
  initial?: IdeaFormInitial;
}) {
  const { messages } = useI18n();
  const t = messages.ideas.form;
  const router = useRouter();
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [category, setCategory] = useState(initial?.category ?? categories[0]?.code ?? "");
  const [angle, setAngle] = useState(initial?.angle ?? angles[0]?.code ?? "");
  const [coreMessage, setCoreMessage] = useState(initial?.coreMessage ?? "");
  const [intent, setIntent] = useState<Intent>(initial?.intent ?? "NONE");
  const [productId, setProductId] = useState(initial?.productId ?? "");
  const [linked, setLinked] = useState<Linked[]>(initial?.cards ?? []);
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useAction(searchIdeaCards, { toastOnError: false });
  const searchRef = useRef(search.run);
  searchRef.current = search.run;
  // Newest approved cards first; a typed query narrows them. Debounced, and a late answer to an
  // older query is ignored.
  useEffect(() => {
    let current = true;
    setSearching(true);
    const timer = setTimeout(
      async () => {
        const result = await searchRef.current({ q: query });
        if (!current) return;
        setSearching(false);
        if (result.ok) setChoices(result.data);
      },
      query ? 300 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const done = (id: string, message: string) => {
    router.push(`/content/ideas/${id}`);
    router.refresh();
    return message;
  };
  const create = useAction(createManualIdea, {
    successMessage: t.created,
    onSuccess: (idea) => done(idea.id, t.created),
    toastOnError: false,
  });
  const update = useAction(updateIdea, {
    successMessage: t.saved,
    onSuccess: (idea) => done(idea.id, t.saved),
    toastOnError: false,
  });
  const action = mode === "create" ? create : update;

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!linked.some((c) => c.role === "PRIMARY")) list.push(t.needPrimary);
    if (intent !== "NONE" && !productId) list.push(t.needProduct);
    if (intent === "NONE" && productId) list.push(t.needIntent);
    return list;
  }, [linked, intent, productId, t]);
  const incomplete = !topic.trim() || !coreMessage.trim() || problems.length > 0;

  const add = (choice: Choice) => {
    if (linked.some((c) => c.id === choice.id)) return;
    setLinked((cards) => [
      ...cards,
      {
        id: choice.id,
        title: choice.title,
        role: cards.some((c) => c.role === "PRIMARY") ? "SUPPORTING" : "PRIMARY",
      },
    ]);
  };
  const setRole = (id: string, role: Role) =>
    setLinked((cards) => cards.map((c) => (c.id === id ? { ...c, role } : c)));

  const [noChanges, setNoChanges] = useState(false);
  const submit = () => {
    if (incomplete) return;
    const knowledge = linked.map((c) => ({ id: c.id, role: c.role }));
    if (mode === "create" || !initial) {
      void create.run({
        topic,
        category,
        angle,
        coreMessage,
        knowledge,
        commercialIntent: intent,
        ...(productId ? { productId } : {}),
      });
      return;
    }
    const patch = {
      ...(topic.trim() !== initial.topic ? { topic } : {}),
      ...(category !== initial.category ? { category } : {}),
      ...(angle !== initial.angle ? { angle } : {}),
      ...(coreMessage.trim() !== initial.coreMessage ? { coreMessage } : {}),
      ...(intent !== initial.intent ? { commercialIntent: intent } : {}),
      ...((productId || null) !== initial.productId ? { productId: productId || null } : {}),
      ...(sameCards(linked, initial.cards) ? {} : { knowledge }),
    };
    if (Object.keys(patch).length === 0) {
      setNoChanges(true);
      return;
    }
    setNoChanges(false);
    void update.run({ id: initial.id, patch });
  };

  const errors = action.fieldErrors;
  const backHref = mode === "edit" && initial ? `/content/ideas/${initial.id}` : "/content/ideas";
  return (
    <form
      className="flex max-w-3xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FieldBlock
        label={t.topic}
        htmlFor="idea-topic"
        hint={t.topicHint}
        error={errors?.topic?.[0]}
      >
        <Input
          id="idea-topic"
          maxLength={200}
          value={topic}
          onChange={(ev) => setTopic(ev.target.value)}
        />
      </FieldBlock>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label={t.category} htmlFor="idea-category" error={errors?.category?.[0]}>
          <select
            id="idea-category"
            className={selectClass}
            value={category}
            onChange={(ev) => setCategory(ev.target.value)}
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </FieldBlock>
        <FieldBlock label={t.angle} htmlFor="idea-angle" error={errors?.angle?.[0]}>
          <select
            id="idea-angle"
            className={selectClass}
            value={angle}
            onChange={(ev) => setAngle(ev.target.value)}
          >
            {angles.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </FieldBlock>
      </div>
      <FieldBlock
        label={t.coreMessage}
        htmlFor="idea-core"
        hint={t.coreMessageHint}
        error={errors?.coreMessage?.[0]}
      >
        <Textarea
          id="idea-core"
          lang="en"
          rows={3}
          maxLength={600}
          value={coreMessage}
          onChange={(ev) => setCoreMessage(ev.target.value)}
        />
      </FieldBlock>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldBlock label={t.intent} htmlFor="idea-intent" error={errors?.commercialIntent?.[0]}>
          <select
            id="idea-intent"
            className={selectClass}
            value={intent}
            onChange={(ev) => setIntent(ev.target.value as Intent)}
          >
            {INTENTS.map((value) => (
              <option key={value} value={value}>
                {messages.ideas.intent[value]}
              </option>
            ))}
          </select>
        </FieldBlock>
        <FieldBlock label={t.product} htmlFor="idea-product" error={errors?.productId?.[0]}>
          <select
            id="idea-product"
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
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="idea-cards">
        <div>
          <h2 id="idea-cards" className="text-sm font-medium">
            {t.cards}
          </h2>
          <p className="text-xs text-muted-foreground">{t.cardsHint}</p>
          {errors?.knowledge?.[0] ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.knowledge[0]}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <h3 className="text-sm font-medium">{t.chosen}</h3>
          {linked.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noneChosen}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {linked.map((card) => (
                <li key={card.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{card.title}</span>
                  <select
                    aria-label={`${card.title}: ${t.role[card.role]}`}
                    className="h-7 rounded-lg border border-input bg-transparent px-2 text-sm"
                    value={card.role}
                    onChange={(ev) => setRole(card.id, ev.target.value as Role)}
                  >
                    <option value="PRIMARY">{t.role.PRIMARY}</option>
                    <option value="SUPPORTING">{t.role.SUPPORTING}</option>
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t.remove}: ${card.title}`}
                    onClick={() => setLinked((cards) => cards.filter((c) => c.id !== card.id))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="idea-card-search" className="text-sm font-medium">
            {t.search}
          </label>
          <Input
            id="idea-card-search"
            type="search"
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
          />
          <ul
            className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border p-1"
            aria-busy={searching}
          >
            {searching && choices.length === 0 ? (
              <li className="p-2 text-sm text-muted-foreground">{t.searching}</li>
            ) : null}
            {!searching && choices.length === 0 ? (
              <li className="p-2 text-sm text-muted-foreground">{t.noResults}</li>
            ) : null}
            {choices.map((choice) => {
              const added = linked.some((c) => c.id === choice.id);
              return (
                <li
                  key={choice.id}
                  className="flex items-start gap-2 rounded-md p-2 hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1" lang={choice.language}>
                    <div className="text-sm font-medium">{choice.title}</div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{choice.claim}</p>
                    <Badge variant="outline" className="mt-1">
                      {format(t.approvedVersion, { version: choice.version })}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={added}
                    aria-label={`${t.add}: ${choice.title}`}
                    onClick={() => add(choice)}
                  >
                    <PlusIcon /> {t.add}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {problems.length > 0 && (topic.trim() || coreMessage.trim() || linked.length > 0) ? (
        <ul className="text-sm text-destructive" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {action.error && !action.fieldErrors ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      ) : null}
      {noChanges ? <p className="text-sm text-muted-foreground">{t.noChanges}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={incomplete || action.pending}>
          {mode === "create" ? t.create : t.save}
        </Button>
        <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
          {t.cancel}
        </Link>
      </div>
    </form>
  );
}

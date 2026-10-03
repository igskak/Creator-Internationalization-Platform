"use client";

import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CardFlagValue,
  type CardsFilters,
  cardsHref,
  clearedFilters,
  hasActiveFilters,
  toggled,
} from "@/lib/cards-query";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { FacetMenu, type FacetOption } from "./facet-menu";

export type CardsFacets = {
  categories: FacetOption[];
  flags: FacetOption[];
  sources: FacetOption[];
  languages: FacetOption[];
};

/** Search box and filter menus of the Knowledge Base list. Every change is a navigation. */
export function CardsToolbar({ filters, facets }: { filters: CardsFilters; facets: CardsFacets }) {
  const { messages } = useI18n();
  const t = messages.cards;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const go = (patch: Partial<CardsFilters>) =>
    startTransition(() => router.push(cardsHref(filters, patch)));

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <search className="relative w-full sm:w-64">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: query.trim() });
          }}
        >
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchLabel}
            className="pl-8"
          />
        </form>
      </search>
      <FacetMenu
        label={t.filters.category}
        options={facets.categories}
        selected={filters.categories}
        onToggle={(value) => go({ categories: toggled(filters.categories, value) })}
        emptyText={t.filters.none}
      />
      <FacetMenu
        label={t.filters.flags}
        options={facets.flags.map((o) => ({ ...o, label: t.flags[o.value as CardFlagValue] }))}
        selected={filters.flags}
        onToggle={(value) => go({ flags: toggled(filters.flags, value as CardFlagValue) })}
        emptyText={t.filters.none}
      />
      <FacetMenu
        label={t.filters.source}
        options={facets.sources}
        selected={filters.sources}
        onToggle={(value) => go({ sources: toggled(filters.sources, value) })}
        emptyText={t.filters.none}
      />
      <FacetMenu
        label={t.filters.language}
        options={facets.languages}
        selected={filters.language ? [filters.language] : []}
        onToggle={(value) => go({ language: filters.language === value ? undefined : value })}
        emptyText={t.filters.none}
      />
      {hasActiveFilters(filters) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery("");
            startTransition(() => router.push(cardsHref(clearedFilters(filters))));
          }}
        >
          {t.filters.clear}
        </Button>
      ) : null}
    </div>
  );
}

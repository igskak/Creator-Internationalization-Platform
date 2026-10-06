"use client";

import type { SourceSearchHit } from "@rc/modules/knowledge";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { searchSources } from "@/server/actions/knowledge";

/** Semantic search over the raw text of the sources, next to the card being edited (M1-21). */
export function SourceSearchPanel({ sourceAssetId }: { sourceAssetId: string | null }) {
  const t = useI18n().messages.card.sourceSearch;
  const [query, setQuery] = useState("");
  const [onlyThis, setOnlyThis] = useState(false);
  const [hits, setHits] = useState<SourceSearchHit[] | null>(null);
  const search = useAction(searchSources, { onSuccess: setHits });

  const where = (hit: { pageStart: number | null; pageEnd: number | null }) => {
    if (!hit.pageStart) return null;
    return hit.pageEnd && hit.pageEnd !== hit.pageStart
      ? format(t.pages, { start: hit.pageStart, end: hit.pageEnd })
      : format(t.page, { page: hit.pageStart });
  };

  return (
    <section
      aria-labelledby="source-search-title"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <div>
        <h2 id="source-search-title" className="text-base font-medium">
          {t.title}
        </h2>
        <p className="text-xs text-muted-foreground">{t.hint}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim().length < 2) return;
          search.run({
            query,
            ...(onlyThis && sourceAssetId ? { sourceAssetId } : {}),
          });
        }}
      >
        <Input
          aria-label={t.title}
          placeholder={t.placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={search.pending || query.trim().length < 2}>
          <SearchIcon /> {search.pending ? t.searching : t.button}
        </Button>
      </form>
      {sourceAssetId ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={onlyThis}
            onChange={(event) => setOnlyThis(event.target.checked)}
          />
          {t.onlyThisSource}
        </label>
      ) : null}
      {hits === null ? null : hits.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.none}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {hits.map((hit) => (
            <li key={hit.chunkId} className="flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{hit.sourceTitle}</span>
                {where(hit) ? <span>{where(hit)}</span> : null}
                {hit.sectionPath ? <span>{hit.sectionPath}</span> : null}
                <span>{format(t.match, { percent: Math.round(hit.similarity * 100) })}</span>
              </div>
              <p className="line-clamp-5 whitespace-pre-line">{hit.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

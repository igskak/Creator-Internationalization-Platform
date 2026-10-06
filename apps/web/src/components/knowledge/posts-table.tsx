"use client";

import { ExternalLinkIcon, StarIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FieldBlock, selectClass } from "@/components/knowledge/field-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { updateHistoricalPostAction } from "@/server/actions/knowledge";

type Annotations = {
  category?: string | undefined;
  angle?: string | undefined;
  hookType?: string | undefined;
  ctaType?: string | undefined;
  productCode?: string | undefined;
  visualPattern?: string | undefined;
};

export type PostTableRow = {
  id: string;
  externalId: string;
  permalink: string | null;
  postedAt: string | null;
  format: "CAROUSEL" | "REEL" | "SINGLE_IMAGE" | null;
  caption: string;
  metrics: Partial<
    Record<"likes" | "comments" | "saves" | "shares" | "reach" | "views", number | undefined>
  >;
  interactions: number | null;
  annotations: Annotations;
  annotationStatus: "NONE" | "AI_SUGGESTED" | "HUMAN_CONFIRMED";
  isExemplar: boolean;
};

export type TermOptions = Record<
  "category" | "angle" | "hookType" | "ctaType",
  { code: string; label: string }[]
>;

const SELECTS = ["category", "angle", "hookType", "ctaType"] as const;

/** The posts with their numbers, annotations and the example switch. */
export function PostsTable({ rows, terms }: { rows: PostTableRow[]; terms: TermOptions }) {
  const { locale, messages } = useI18n();
  const t = messages.posts;
  const router = useRouter();
  const [editing, setEditing] = useState<PostTableRow | null>(null);
  const [draft, setDraft] = useState<Annotations>({});
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const number = new Intl.NumberFormat(locale);
  const label = (kind: keyof TermOptions, code: string) =>
    terms[kind].find((term) => term.code === code)?.label ?? code;

  const save = useAction(updateHistoricalPostAction, {
    onSuccess: () => {
      setEditing(null);
      toast.success(t.annotate.saved);
      router.refresh();
    },
  });

  const open = (row: PostTableRow) => {
    setDraft({ ...row.annotations });
    setEditing(row);
  };
  const submit = () => {
    if (!editing) return;
    const keys = [...SELECTS, "productCode", "visualPattern"] as const;
    const patch: Record<string, string | null> = {};
    for (const key of keys) {
      const next = (draft[key] ?? "").trim();
      const before = editing.annotations[key] ?? "";
      if (next !== before) patch[key] = next || null;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    save.run({ id: editing.id, annotations: patch });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t.table.post}</th>
              <th className="px-3 py-2 font-medium">{t.table.numbers}</th>
              <th className="px-3 py-2 font-medium">{t.table.annotations}</th>
              <th className="px-3 py-2 font-medium">{t.table.example}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <td className="max-w-md px-3 py-3">
                  <p className="line-clamp-3 whitespace-pre-line">{row.caption}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>
                      {row.postedAt ? date.format(new Date(row.postedAt)) : t.table.noDate}
                    </span>
                    {row.format ? <span>{t.formats[row.format]}</span> : null}
                    {row.permalink ? (
                      <a
                        href={row.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-4"
                      >
                        {t.table.open} <ExternalLinkIcon aria-hidden="true" className="size-3" />
                      </a>
                    ) : null}
                  </p>
                </td>
                <td className="px-3 py-3 text-xs">
                  {row.interactions !== null ? (
                    <p className="font-medium">
                      {format(t.table.interactions, { count: number.format(row.interactions) })}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">
                    {(["likes", "comments", "saves", "shares", "reach", "views"] as const)
                      .filter((key) => row.metrics[key] !== undefined)
                      .map((key) => `${number.format(row.metrics[key] ?? 0)} ${t.table[key]}`)
                      .join(" · ")}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {SELECTS.map((kind) =>
                      row.annotations[kind] ? (
                        <Badge key={kind} variant="outline">
                          {label(kind, row.annotations[kind] ?? "")}
                        </Badge>
                      ) : null,
                    )}
                    {row.annotations.productCode ? (
                      <Badge variant="outline">{row.annotations.productCode}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t.status[row.annotationStatus]}
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => open(row)}>
                      {t.annotate.button}
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <ExemplarToggle row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(value) => !value && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.annotate.title}</DialogTitle>
          </DialogHeader>
          {SELECTS.map((kind) => (
            <FieldBlock
              key={kind}
              label={t.annotate[kind]}
              htmlFor={`annotate-${kind}`}
              error={save.fieldErrors?.[`annotations.${kind}`]?.[0]}
            >
              <select
                id={`annotate-${kind}`}
                className={selectClass}
                value={draft[kind] ?? ""}
                onChange={(event) => setDraft({ ...draft, [kind]: event.target.value })}
              >
                <option value="">{t.annotate.none}</option>
                {terms[kind].map((term) => (
                  <option key={term.code} value={term.code}>
                    {term.label}
                  </option>
                ))}
              </select>
            </FieldBlock>
          ))}
          <FieldBlock label={t.annotate.productCode} htmlFor="annotate-product">
            <Input
              id="annotate-product"
              value={draft.productCode ?? ""}
              onChange={(event) => setDraft({ ...draft, productCode: event.target.value })}
            />
          </FieldBlock>
          <FieldBlock label={t.annotate.visualPattern} htmlFor="annotate-visual">
            <Input
              id="annotate-visual"
              value={draft.visualPattern ?? ""}
              onChange={(event) => setDraft({ ...draft, visualPattern: event.target.value })}
            />
          </FieldBlock>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={save.pending}>
              {t.annotate.cancel}
            </Button>
            <Button onClick={submit} disabled={save.pending}>
              {save.pending ? t.annotate.saving : t.annotate.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExemplarToggle({ row }: { row: PostTableRow }) {
  const t = useI18n().messages.posts;
  const router = useRouter();
  const toggle = useAction(updateHistoricalPostAction, { onSuccess: () => router.refresh() });
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-pressed={row.isExemplar}
      aria-label={row.isExemplar ? t.unmarkExample : t.markExample}
      title={row.isExemplar ? t.unmarkExample : t.markExample}
      disabled={toggle.pending}
      onClick={() => toggle.run({ id: row.id, isExemplar: !row.isExemplar })}
    >
      <StarIcon className={cn(row.isExemplar && "fill-amber-400 text-amber-500")} />
    </Button>
  );
}

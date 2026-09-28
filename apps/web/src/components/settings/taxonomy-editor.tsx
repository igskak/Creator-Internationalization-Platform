"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/hooks/use-action";
import { upsertTaxonomyTerm } from "@/server/actions/settings";
import { errorsFor, FieldErrorText } from "./field-errors";

export type TaxonomyTermRow = { kind: string; code: string; label: string; isActive: boolean };

const KINDS = [
  "category",
  "subcategory",
  "angle",
  "hook_type",
  "cta_type",
  "visual_style",
  "reason_code",
] as const;
type Kind = (typeof KINDS)[number];

function TermRow({ term, canEdit }: { term: TaxonomyTermRow; canEdit: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState(term.label);
  const { run, pending } = useAction(upsertTaxonomyTerm, { onSuccess: () => router.refresh() });
  const save = (isActive: boolean) =>
    void run({ kind: term.kind as Kind, code: term.code, label, isActive });
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-1.5 last:border-0">
      <span className="w-56 truncate font-mono text-xs">{term.code}</span>
      <Input
        className="h-7 max-w-64"
        value={label}
        disabled={!canEdit || pending}
        aria-label={`Label for ${term.code}`}
        onChange={(e) => setLabel(e.target.value)}
      />
      {!term.isActive && <Badge variant="secondary">inactive</Badge>}
      {canEdit && (
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || label === term.label}
            onClick={() => save(term.isActive)}
          >
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => save(!term.isActive)}
          >
            {term.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      )}
    </div>
  );
}

function AddTerm({ kind }: { kind: Kind }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const { run, pending, fieldErrors } = useAction(upsertTaxonomyTerm, {
    successMessage: "Term added",
    toastOnError: false,
    onSuccess: () => {
      setCode("");
      setLabel("");
      router.refresh();
    },
  });
  return (
    <form
      className="flex flex-col gap-1 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ kind, code: code.trim(), label: label.trim(), isActive: true });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          className="h-8 w-56 font-mono"
          placeholder="NEW_CODE"
          value={code}
          aria-label="New code"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Input
          className="h-8 max-w-64"
          placeholder="Label"
          value={label}
          aria-label="New label"
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={pending || !code || !label}>
          Add
        </Button>
      </div>
      <FieldErrorText
        messages={[...errorsFor(fieldErrors, "code"), ...errorsFor(fieldErrors, "label")]}
      />
    </form>
  );
}

/** Taxonomy terms by kind (05 §5.2 upsertTaxonomyTerm, owner). Terms are deactivated, never deleted. */
export function TaxonomyEditor({ terms, canEdit }: { terms: TaxonomyTermRow[]; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Taxonomy</CardTitle>
        <CardDescription>
          Codes are stored on content; labels can change. Used codes are deactivated, not deleted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="category">
          <TabsList className="flex-wrap">
            {KINDS.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {kind.replace("_", " ")}
              </TabsTrigger>
            ))}
          </TabsList>
          {KINDS.map((kind) => {
            const list = terms.filter((t) => t.kind === kind);
            return (
              <TabsContent key={kind} value={kind} className="pt-2">
                {list.length === 0 && (
                  <p className="text-sm text-muted-foreground">No terms yet.</p>
                )}
                {list.map((term) => (
                  <TermRow key={`${term.kind}:${term.code}`} term={term} canEdit={canEdit} />
                ))}
                {canEdit && <AddTerm kind={kind} />}
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}

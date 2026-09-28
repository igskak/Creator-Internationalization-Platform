"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { updateBrand } from "@/server/actions/settings";
import { errorsFor, FieldErrorText } from "./field-errors";

export type BrandFormValues = {
  id: string;
  name: string;
  description: string | null;
  brandVoice: string;
};

/** Name, description and the Markdown voice guide used in prompts (05 §5.2 updateBrand, owner). */
export function BrandForm({ brand, canEdit }: { brand: BrandFormValues; canEdit: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(brand);
  const { run, pending, fieldErrors } = useAction(updateBrand, {
    successMessage: "Brand saved",
    onSuccess: () => router.refresh(),
  });
  const disabled = !canEdit || pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand and voice guide</CardTitle>
        <CardDescription>
          The voice guide (Markdown) is included in every writing prompt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run({
              brandId: values.id,
              name: values.name,
              description: values.description,
              brandVoice: values.brandVoice,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brand-name">Name</Label>
              <Input
                id="brand-name"
                value={values.name}
                disabled={disabled}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
              <FieldErrorText messages={errorsFor(fieldErrors, "name")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brand-description">Description</Label>
              <Input
                id="brand-description"
                value={values.description ?? ""}
                disabled={disabled}
                onChange={(e) => setValues({ ...values, description: e.target.value || null })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-voice">Voice guide (Markdown)</Label>
            <Textarea
              id="brand-voice"
              rows={16}
              className="font-mono text-sm"
              value={values.brandVoice}
              disabled={disabled}
              onChange={(e) => setValues({ ...values, brandVoice: e.target.value })}
            />
            <span className="text-xs text-muted-foreground">
              {values.brandVoice.length.toLocaleString()} characters
            </span>
            <FieldErrorText messages={errorsFor(fieldErrors, "brandVoice")} />
          </div>
          {canEdit && (
            <Button type="submit" className="self-end" disabled={pending}>
              {pending ? "Saving…" : "Save brand"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

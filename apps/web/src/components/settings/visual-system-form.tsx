"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { updateBrand } from "@/server/actions/settings";
import { errorsFor } from "./field-errors";

const EXAMPLE = {
  colors: {
    background: "#FFFFFF",
    surface: "#F4F1EC",
    text: "#1A1A1A",
    accent: "#C8553D",
    positive: "#2E7D32",
    negative: "#C62828",
  },
  fonts: { display: "display-serif", body: "body-sans" },
  logo: { assetKey: "brand/logo.svg", minHeightPx: 48 },
  spacing: { safeMarginPx: 64 },
  themeVariants: {},
};

/** Visual system JSON editor; the server validates it against the VisualSystem schema (04 §4.4). */
export function VisualSystemForm({
  brandId,
  visualSystem,
  canEdit,
}: {
  brandId: string;
  visualSystem: unknown;
  canEdit: boolean;
}) {
  const router = useRouter();
  const configured =
    visualSystem && typeof visualSystem === "object" && Object.keys(visualSystem).length > 0;
  const [text, setText] = useState(JSON.stringify(configured ? visualSystem : EXAMPLE, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const { run, pending, fieldErrors } = useAction(updateBrand, {
    successMessage: "Visual system saved",
    toastOnError: false,
    onSuccess: () => router.refresh(),
  });
  const schemaErrors = errorsFor(fieldErrors, "visualSystem", true);

  function save() {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      setParseError(`Not valid JSON: ${(error as Error).message}`);
      return;
    }
    setParseError(null);
    void run({ brandId, visualSystem: value });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Visual system</CardTitle>
        <CardDescription>
          Colors (#RRGGBB), font ids bundled in the templates, logo, safe margin and theme variants.
          {!configured && " Not configured yet — the example below is a starting point."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          aria-label="Visual system JSON"
          rows={18}
          className="font-mono text-xs"
          value={text}
          disabled={!canEdit || pending}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={parseError || schemaErrors.length ? true : undefined}
        />
        {(parseError || schemaErrors.length > 0) && (
          <ul role="alert" className="list-disc pl-5 text-sm text-destructive">
            {parseError && <li>{parseError}</li>}
            {schemaErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {canEdit && (
          <Button type="button" className="self-end" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save visual system"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

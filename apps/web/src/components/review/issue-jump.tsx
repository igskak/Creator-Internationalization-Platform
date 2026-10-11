"use client";

import { CornerDownRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { useVariant } from "./variant-state";

const FIELD =
  /^(hook|caption|cta|hashtags|slides\.[A-Za-z0-9_-]+(\.(slots|images)\.[A-Za-z0-9_-]+)?)$/;

/** A critic issue's "go to the field" link (plan 10 §10.3): scrolls to the field and opens its slide. */
export function IssueJump({ path }: { path: string | undefined }) {
  const t = useI18n().messages.review.edit;
  const { focusField } = useVariant();
  if (!path || !FIELD.test(path)) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`${t.jump}: ${path}`}
      title={t.jump}
      onClick={() => focusField(path)}
    >
      <CornerDownRightIcon />
    </Button>
  );
}

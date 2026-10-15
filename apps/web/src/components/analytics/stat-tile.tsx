import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A headline number: label (sentence case), value, and one line of context. No decoration. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** `bad` for a number that is bad when it is high (it is never colour alone: the hint says why). */
  tone?: "default" | "muted";
  testId?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled tile, not a form group
    <div
      data-stat={testId}
      className="flex flex-col gap-1 rounded-xl border p-4"
      role="group"
      aria-label={label}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-3xl font-semibold tracking-tight",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

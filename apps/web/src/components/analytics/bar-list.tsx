import Link from "next/link";
import { cn } from "@/lib/utils";

// A horizontal bar chart for a handful of named values (dataviz skill): one hue, bars at most 24 px
// thick with a 4 px rounded end and a square baseline, the value at the tip, a hairline baseline.
// The values are text too, so nothing depends on the colour or the hover.

export type BarRow = {
  key: string;
  label: string;
  /** The number the bar is long by (>= 0). */
  value: number;
  /** The value as written at the tip. */
  display: string;
  /** Second line under the label (the count, "low sample"). */
  note?: string;
  /** A group that is too small to trust is drawn in the muted tone. */
  muted?: boolean;
  href?: string;
};

export function BarList({
  title,
  rows,
  empty,
  ariaLabel,
}: {
  title?: string;
  rows: BarRow[];
  empty: string;
  ariaLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{empty}</p>
    );
  }
  const max = Math.max(...rows.map((r) => r.value), Number.EPSILON);
  return (
    <figure className="flex flex-col gap-2" aria-label={ariaLabel}>
      {title ? <figcaption className="text-sm font-medium">{title}</figcaption> : null}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const label = (
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{row.label}</span>
              {row.note ? <span className="text-xs text-muted-foreground">{row.note}</span> : null}
            </span>
          );
          return (
            <li
              key={row.key}
              data-bar={row.key}
              title={`${row.label}: ${row.display}${row.note ? ` (${row.note})` : ""}`}
              className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3 py-1"
            >
              {row.href ? (
                <Link href={row.href} className="min-w-0 underline-offset-4 hover:underline">
                  {label}
                </Link>
              ) : (
                label
              )}
              {/* The track has the hairline baseline on its left edge; the bar grows from it. */}
              <span className="flex h-6 items-center border-l border-[var(--viz-grid)]">
                <span
                  className={cn("h-5 rounded-r-[4px]", row.muted ? "opacity-40" : "")}
                  style={{
                    width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / max) * 100)}%`,
                    background: "var(--viz-series-1)",
                  }}
                />
              </span>
              <span className="text-sm font-medium tabular-nums">{row.display}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

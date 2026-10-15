"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import {
  compact,
  linePaths,
  nearestIndex,
  niceTicks,
  type Point,
  percent,
  rangeTicks,
} from "./chart-math";

// A single-series line chart (dataviz skill): a 2 px line, a ~10 % wash under it, hairline grid,
// round axis ticks, the last value labelled, and a crosshair that snaps to the nearest day with
// its value in a tooltip (hover and keyboard). A missing day breaks the line. The same numbers are
// in the table under the chart, so nothing depends on the tooltip.

const H = 220;
const M = { top: 12, right: 64, bottom: 26, left: 52 };

export function LineChart({
  title,
  points,
  kind,
  baseline = "zero",
  series = 1,
  empty,
  tableLabel,
  dateHeader,
  valueHeader,
  tableView = true,
}: {
  title: string;
  points: Point[];
  /** How a value reads: a count (1,284 / 12.9K) or a share (7.3 %). Functions cannot cross from the server. */
  kind: "count" | "percent";
  /** `zero`: the axis starts at 0 (reach, shares). `data`: it hugs the data (followers). */
  baseline?: "zero" | "data";
  /** Which series colour of the palette: 1 (blue) or 2 (orange). */
  series?: 1 | 2;
  empty: string;
  tableLabel: string;
  dateHeader: string;
  valueHeader: string;
  /** False where the same numbers are in a table next to the chart. */
  tableView?: boolean;
}) {
  const { locale } = useI18n();
  const format = (value: number) =>
    kind === "percent" ? percent(value, locale) : compact(value, locale);
  const tickFormat = (value: number) =>
    kind === "percent" ? percent(value, locale, 0) : compact(value, locale);
  const dayFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const formatDate = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  // The chart is drawn at the width it has, so the text stays the size it was set in.
  const [W, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [active, setActive] = useState<number | null>(null);
  const valued = points.filter((p) => p.value !== null);
  const color = `var(--viz-series-${series})`;

  if (valued.length === 0) {
    return (
      <figure className="flex min-w-0 flex-col gap-2" aria-label={title}>
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{empty}</p>
      </figure>
    );
  }

  const values = valued.map((p) => p.value as number);
  const ticks =
    baseline === "zero"
      ? niceTicks(Math.max(...values))
      : rangeTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0] as number;
  const hi = ticks.at(-1) as number;
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (i: number) =>
    M.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => M.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const paths = linePaths(points, x, y);
  const lastIndex = points.reduce((last, p, i) => (p.value === null ? last : i), 0);
  const last = points[lastIndex] as Point;
  const current = active === null ? null : (points[active] ?? null);
  const labelDates = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setActive(nearestIndex(points, ((clientX - rect.left) / rect.width) * W, x));
  };
  const step = (direction: 1 | -1) => {
    const from = active ?? (direction === 1 ? -1 : points.length);
    for (let i = from + direction; i >= 0 && i < points.length; i += direction) {
      if (points[i]?.value !== null) {
        setActive(i);
        return;
      }
    }
  };

  return (
    <figure className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div ref={box} className="relative w-full min-w-0">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${id}-t`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the keyboard moves the crosshair
          tabIndex={0}
          height={H}
          className="block w-full touch-none outline-offset-2"
          onPointerMove={(e) => move(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(1);
            else if (e.key === "ArrowLeft") step(-1);
            else if (e.key === "Escape") setActive(null);
            else return;
            e.preventDefault();
          }}
        >
          <title id={`${id}-t`}>{`${title}: ${format(last.value as number)}`}</title>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--viz-grid)"
                strokeWidth={1}
              />
              <text
                x={M.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {tickFormat(tick)}
              </text>
            </g>
          ))}
          {labelDates.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-muted-foreground text-[11px]"
            >
              {formatDate((points[i] as Point).date)}
            </text>
          ))}
          {paths.map((run) => (
            <g key={run.d}>
              <path
                d={`${run.d} L${run.x1.toFixed(1)} ${y(lo).toFixed(1)} L${run.x0.toFixed(1)} ${y(lo).toFixed(1)} Z`}
                fill={color}
                opacity={0.1}
              />
              <path
                d={run.d}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ))}
          {/* The last value, labelled at the end of the line. */}
          <circle
            cx={x(lastIndex)}
            cy={y(last.value as number)}
            r={4}
            fill={color}
            stroke="var(--background)"
            strokeWidth={2}
          />
          <text
            x={x(lastIndex) + 10}
            y={y(last.value as number)}
            dominantBaseline="middle"
            className="fill-foreground text-[12px] font-medium tabular-nums"
          >
            {format(last.value as number)}
          </text>
          {current && current.value !== null && active !== null ? (
            <g pointerEvents="none">
              <line
                x1={x(active)}
                x2={x(active)}
                y1={M.top}
                y2={M.top + innerH}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
              />
              <circle
                cx={x(active)}
                cy={y(current.value)}
                r={4}
                fill={color}
                stroke="var(--background)"
                strokeWidth={2}
              />
            </g>
          ) : null}
        </svg>
        {current && current.value !== null && active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
            style={{
              left: `${Math.min(88, Math.max(12, (x(active) / W) * 100))}%`,
              top: `${(y(current.value) / H) * 100 - 16}%`,
            }}
          >
            <p className="text-sm font-semibold tabular-nums">{format(current.value)}</p>
            <p className="text-xs text-muted-foreground">{formatDate(current.date)}</p>
          </div>
        ) : null}
      </div>
      {tableView ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{tableLabel}</summary>
          <table className="mt-2 w-full max-w-sm text-left tabular-nums">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 font-medium">{dateHeader}</th>
                <th className="py-1 font-medium">{valueHeader}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-t">
                  <td className="py-1">{formatDate(p.date)}</td>
                  <td className="py-1">{p.value === null ? "—" : format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </figure>
  );
}

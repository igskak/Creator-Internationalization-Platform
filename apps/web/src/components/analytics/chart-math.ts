// The arithmetic of the dashboards' charts: round axis ticks, compact numbers, the path of a line
// with gaps. Pure functions, no DOM.

/** Round tick values from 0 to a little above `max` (about `count` of them). */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  return ticks;
}

/**
 * Round ticks that cover [min, max] without starting at zero: for a series whose changes would be
 * flattened by a zero baseline (followers). The first and last tick enclose the data.
 */
export function rangeTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min - 1, min, min + 1].map((v) => Math.round(v));
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((v) => v >= rough) ?? rough;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  return ticks;
}

/** 1,284 / 12.9K / 4.2M, in the viewer's locale. */
export function compact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(value);
}

export const percent = (value: number, locale: string, digits = 1): string =>
  new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

export type Point = { date: string; value: number | null };

export type PathRun = { d: string; x0: number; x1: number };

/**
 * The SVG path of each run of consecutive values, with the x of its first and last point (to close
 * an area under it). A null value breaks the line; it is a gap, never a zero.
 */
export function linePaths(
  points: readonly Point[],
  x: (index: number) => number,
  y: (value: number) => number,
): PathRun[] {
  const runs: PathRun[] = [];
  let parts: string[] = [];
  let x0 = 0;
  let x1 = 0;
  const close = () => {
    if (parts.length > 0) runs.push({ d: parts.join(" "), x0, x1 });
    parts = [];
  };
  points.forEach((p, i) => {
    if (p.value === null) {
      close();
      return;
    }
    if (parts.length === 0) x0 = x(i);
    x1 = x(i);
    parts.push(`${parts.length === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`);
  });
  close();
  return runs;
}

/** The index of the point nearest to a pointer position, among points with a value. */
export function nearestIndex(
  points: readonly Point[],
  pointerX: number,
  x: (index: number) => number,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((p, i) => {
    if (p.value === null) return;
    const distance = Math.abs(x(i) - pointerX);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

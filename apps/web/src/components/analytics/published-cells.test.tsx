// @vitest-environment jsdom
import type { PublishedRow } from "@rc/modules/analytics";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { ru } from "@/lib/i18n/ru";
import { MeasuredCell, WatchCell } from "./published-cells";

// The snapshot and watch cells of the Published list on synthetic rows: a post with only H2, a
// Reel with only H2 and D1, a fallback from D3, day 7, and no numbers at all.

afterEach(cleanup);

const row = (over: Partial<PublishedRow> = {}): PublishedRow => ({
  publicationId: "00000000-0000-4000-8000-0000000000c1",
  variantId: "00000000-0000-4000-8000-0000000000c2",
  ideaId: "00000000-0000-4000-8000-0000000000c3",
  marketCode: "es-ES",
  format: "CAROUSEL",
  hook: "Nunca laves el arroz",
  hookType: "MYTH_BUST",
  publishedAt: new Date("2026-10-20T18:00:00Z"),
  permalink: null,
  youtubeUrl: null,
  slot: null,
  isExactD7: null,
  early: false,
  reach: null,
  saveRate: null,
  shareRate: null,
  commentRate: null,
  engagementRate: null,
  watch: null,
  ...over,
});
const t = en.published;

describe("MeasuredCell", () => {
  it("marks an H2-only post as early, with a hint", () => {
    render(
      <MeasuredCell row={row({ slot: "H2", isExactD7: false, early: true, reach: 120 })} t={t} />,
    );
    const badge = screen.getByText("Early: H2");
    expect(badge.getAttribute("title")).toBe(t.earlyHint);
    expect(screen.queryByText(t.noNumbers)).toBeNull();
  });

  it("marks a D1-only post as early, in Russian too", () => {
    render(
      <MeasuredCell row={row({ slot: "D1", isExactD7: false, early: true })} t={ru.published} />,
    );
    expect(screen.getByText("Ранние: D1")).toBeTruthy();
  });

  it("keeps day 7, the D3 fallback and the no-numbers state", () => {
    render(<MeasuredCell row={row({ slot: "D7", isExactD7: true })} t={t} />);
    expect(screen.getByText(t.measuredAt)).toBeTruthy();
    cleanup();
    render(<MeasuredCell row={row({ slot: "D3", isExactD7: false })} t={t} />);
    expect(screen.getByText("Not day 7 yet: D3")).toBeTruthy();
    cleanup();
    render(<MeasuredCell row={row()} t={t} />);
    expect(screen.getByText(t.noNumbers)).toBeTruthy();
  });
});

describe("WatchCell", () => {
  it("shows a D1-only Reel's average watch time, early retention and share watched", () => {
    render(
      <WatchCell
        row={row({
          format: "REEL",
          slot: "D1",
          early: true,
          watch: {
            avgWatchSeconds: 4.24,
            totalWatchHours: 0.35,
            skipRate: 0.35,
            hookRate: 0.65,
            completion: 0.21,
          },
        })}
        t={t}
        locale="en"
      />,
    );
    expect(screen.getByTestId("watch").textContent).toBe(
      "4.2 s on average65.0% stayed past the first seconds21.0% of the Reel watched",
    );
  });

  it("leaves out what an H2 snapshot did not give, and shows a dash for nothing", () => {
    const empty = {
      avgWatchSeconds: null,
      totalWatchHours: null,
      skipRate: null,
      hookRate: null,
      completion: null,
    };
    render(
      <WatchCell
        row={row({
          format: "REEL",
          slot: "H2",
          early: true,
          watch: { ...empty, avgWatchSeconds: 3 },
        })}
        t={t}
        locale="en"
      />,
    );
    expect(screen.getByTestId("watch").textContent).toBe("3 s on average");
    cleanup();
    render(<WatchCell row={row({ format: "REEL", watch: empty })} t={t} locale="en" />);
    expect(screen.queryByTestId("watch")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

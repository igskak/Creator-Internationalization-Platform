// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { ru } from "@/lib/i18n/ru";
import { reelInsightsFixture } from "./fixtures";
import { ReelsSection } from "./reels-section";

// M8-10: the Reels of the Engagement tab: tiles, the table with the source carousel, dashes for
// what Instagram did not give, the empty window.

afterEach(cleanup);
const tile = (name: string) => screen.getByRole("group", { name });

describe("ReelsSection", () => {
  it("shows watch time, hook rate, completion and reach against the carousel", () => {
    render(<ReelsSection reels={reelInsightsFixture()} t={en.analytics} locale="en" />);
    expect(within(tile("Median watch time")).getByText("7.4 s")).toBeInTheDocument();
    expect(within(tile("Median hook rate")).getByText("66%")).toBeInTheDocument();
    expect(within(tile("Median completion")).getByText("41%")).toBeInTheDocument();
    expect(within(tile("Reach against the carousel")).getByText("1.35×")).toBeInTheDocument();
    const rows = within(screen.getByTestId("reels-table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const first = rows[1] as HTMLElement;
    expect(within(first).getByRole("link", { name: /^2,000 \/ 3\.4%$/u })).toHaveAttribute(
      "href",
      "/content/published/00000000-0000-4000-8000-0000000000a8",
    );
    // A Reel without a published carousel and without a save rate yet: dashes.
    expect(within(rows[2] as HTMLElement).getAllByText("—")).toHaveLength(2);
  });

  it("says when no Reel was published, in Russian too", () => {
    const empty = reelInsightsFixture();
    empty.tiles.reels = 0;
    empty.reels = [];
    render(<ReelsSection reels={empty} t={ru.analytics} locale="ru" />);
    expect(screen.getByText("За этот период Reels не публиковались.")).toBeInTheDocument();
  });
});

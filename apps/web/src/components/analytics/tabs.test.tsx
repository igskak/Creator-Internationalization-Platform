// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import {
  engagementFixture,
  growthFixture,
  learningFixture,
  operationsFixture,
  rankedFixture,
} from "./fixtures";
import { LineChart } from "./line-chart";
import { EngagementTab, GrowthTab, LearningTab, OperationsTab } from "./tabs";

// The dashboard tabs on synthetic data (M6-05 to M6-07): the numbers the tiles show, the table,
// the marks for a small group, the states with no data, and both languages.

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(cleanup);

const wrap = (node: React.ReactNode, locale: "en" | "ru" = "en") =>
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : ru}>
      {node}
    </I18nProvider>,
  );
const tile = (name: string) => screen.getByRole("group", { name });

describe("Growth", () => {
  it("shows the four tiles and one chart per series", () => {
    wrap(<GrowthTab growth={growthFixture()} t={en.analytics} locale="en" />);
    expect(within(tile("Followers")).getByText("1,432")).toBeInTheDocument();
    expect(within(tile("Follower growth")).getByText("+96")).toBeInTheDocument();
    expect(within(tile("Daily reach")).getByText("2,860")).toBeInTheDocument();
    expect(within(tile("Reach from non-followers")).getByText("62%")).toBeInTheDocument();
    for (const title of ["Followers", "Reach per day", "Share of reach from non-followers"]) {
      expect(screen.getByRole("figure", { name: title })).toBeInTheDocument();
    }
  });

  it("says what is missing when the window has no snapshot", () => {
    const empty = growthFixture();
    empty.tiles.days = 0;
    wrap(<GrowthTab growth={empty} t={en.analytics} locale="en" />);
    expect(screen.getByText(/collected daily after the account is connected/)).toBeInTheDocument();
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("shows a dash, not a zero, for a tile with no number", () => {
    const g = growthFixture();
    g.tiles.followerGrowth = null;
    g.tiles.nonFollowerShare = null;
    wrap(<GrowthTab growth={g} t={en.analytics} locale="en" />);
    expect(within(tile("Follower growth")).getByText("—")).toBeInTheDocument();
    expect(within(tile("Reach from non-followers")).getByText("—")).toBeInTheDocument();
  });
});

describe("LineChart", () => {
  const points = [
    { date: "2026-10-01", value: 10 },
    { date: "2026-10-02", value: null },
    { date: "2026-10-03", value: 30 },
  ];
  const props = {
    title: "Reach",
    points,
    kind: "count" as const,
    empty: "Nothing yet.",
    tableLabel: "Show table",
    dateHeader: "Date",
    valueHeader: "Value",
  };

  it("labels the last value and keeps every number in a table, a missing day as a dash", () => {
    wrap(<LineChart {...props} />);
    const figure = screen.getByRole("figure", { name: "Reach" });
    expect(within(figure).getAllByText("30").length).toBeGreaterThan(0);
    const rows = within(figure).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual(["DateValue", "Oct 110", "Oct 2—", "Oct 330"]);
  });

  it("draws the line in two pieces across the gap", () => {
    const { container } = wrap(<LineChart {...props} />);
    const lines = container.querySelectorAll('path[stroke="var(--viz-series-1)"]');
    expect(lines).toHaveLength(2);
  });

  it("shows the value of the nearest day on the keyboard", () => {
    const { container } = wrap(<LineChart {...props} />);
    const svg = container.querySelector("svg") as SVGElement;
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("10");
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    // The day without a value is skipped.
    expect(screen.getByRole("status")).toHaveTextContent("30");
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says so when there is nothing to draw", () => {
    wrap(<LineChart {...props} points={[{ date: "2026-10-01", value: null }]} />);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
    expect(container_has_no_svg()).toBe(true);
  });
});
const container_has_no_svg = () => document.querySelector("svg") === null;

describe("Engagement", () => {
  it("shows the medians, and one row per post with a flag where D7 has not come", () => {
    wrap(<EngagementTab engagement={engagementFixture()} t={en.analytics} locale="en" />);
    expect(within(tile("Median save rate")).getByText("4.3%")).toBeInTheDocument();
    expect(
      within(tile("Posts")).getByText(/5 with numbers, 4 measured at day 7/),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    const fallback = rows.find((r) => r.textContent?.includes("Why is your rice sticky?"));
    expect(fallback).toHaveTextContent("Not day 7 yet: D3");
    const fresh = rows.find((r) => r.textContent?.includes("Fresh post"));
    expect(fresh).toHaveTextContent("No numbers yet");
    expect(fresh?.querySelector("a")).toHaveAttribute(
      "href",
      "/content/published/00000000-0000-4000-8000-000000000009",
    );
  });

  it("says so when no post was published in the window", () => {
    const e = engagementFixture();
    e.posts = [];
    wrap(<EngagementTab engagement={e} t={en.analytics} locale="en" />);
    expect(screen.getByText("No post was published in this window.")).toBeInTheDocument();
  });
});

describe("Content learning", () => {
  const labels = { value: (v: string) => (v === "NONE" ? "Not set" : v) };
  it("lists the groups with their lift, marks the small ones, and ranks posts", () => {
    wrap(
      <LearningTab
        learning={learningFixture()}
        ranked={rankedFixture()}
        t={en.analytics}
        locale="en"
        labels={labels}
      />,
    );
    const myth = screen.getByRole("row", { name: /MYTH_BUST/ });
    expect(myth).toHaveTextContent("1.61×");
    expect(myth).not.toHaveTextContent("low sample");
    expect(screen.getByRole("row", { name: /CURIOSITY_GAP/ })).toHaveTextContent("low sample");
    expect(screen.getByRole("row", { name: /Not set/ })).toHaveTextContent("low sample");
    // The bar chart carries the lift in words, and the market line says what it is compared with.
    expect(screen.getAllByText(/1\.61× the market/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Market median: 3\.8% save rate over 14 posts/)).toBeInTheDocument();
    const best = screen.getByRole("region", { name: "Best posts" });
    expect(within(best).getAllByRole("listitem")).toHaveLength(3);
    const weakest = screen.getByRole("region", { name: "Weakest posts" });
    expect(within(weakest).getAllByRole("listitem")).toHaveLength(2);
  });

  it("says there is nothing to compare when no post has numbers at day 7", () => {
    const l = learningFixture();
    l.rows = [];
    wrap(
      <LearningTab
        learning={l}
        ranked={{ top: [], bottom: [], considered: 0 }}
        t={en.analytics}
        locale="en"
        labels={labels}
      />,
    );
    expect(screen.getByText(/has numbers at day 7 in this window yet/)).toBeInTheDocument();
  });
});

describe("Operations", () => {
  it("shows the production numbers and the rejection reasons with their labels", () => {
    wrap(
      <OperationsTab
        operations={operationsFixture()}
        t={en.analytics}
        locale="en"
        reasonLabels={{ WEAK_HOOK: "Weak hook" }}
      />,
    );
    expect(within(tile("Approval rate")).getByText("73%")).toBeInTheDocument();
    expect(within(tile("Time to approve")).getByText("5.5 h")).toBeInTheDocument();
    expect(within(tile("Model cost per approved post")).getByText("$1.87")).toBeInTheDocument();
    expect(screen.getByText("Weak hook")).toBeInTheDocument();
    // A code with no label is shown as it is.
    expect(screen.getByText("VISUAL_ISSUE")).toBeInTheDocument();
  });

  it("shows dashes and the empty reasons line for a window with nothing in it", () => {
    wrap(
      <OperationsTab
        operations={{
          generated: 0,
          approved: 0,
          rejected: 0,
          approvalRate: null,
          rejectionReasons: [],
          avgEditsPerApproved: null,
          medianTimeToApproveHours: null,
          criticPassRate: null,
          criticReports: 0,
          regenerationsPerVariant: null,
          costPerApprovedPost: null,
        }}
        t={en.analytics}
        locale="en"
        reasonLabels={{}}
      />,
    );
    expect(within(tile("Approval rate")).getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Nothing was rejected in this window.")).toBeInTheDocument();
  });
});

describe("in Russian", () => {
  it("speaks Russian in every tab", () => {
    wrap(
      <>
        <GrowthTab growth={growthFixture()} t={ru.analytics} locale="ru" />
        <OperationsTab
          operations={operationsFixture()}
          t={ru.analytics}
          locale="ru"
          reasonLabels={{}}
        />
      </>,
      "ru",
    );
    expect(screen.getByRole("group", { name: "Подписчики" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Доля одобренных" })).toBeInTheDocument();
    expect(screen.getByText("5,5 ч")).toBeInTheDocument();
  });
});

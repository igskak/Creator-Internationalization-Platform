// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { lineageFixture } from "./fixtures";
import { LineageView } from "./lineage";

// The lineage screen of one post on synthetic data (M6-09): the numbers, the chain from the source
// to the post, the states with no data, and both languages.

vi.mock("./collect-now-button", () => ({
  CollectNowButton: ({ canManage }: { canManage: boolean }) => (
    <button type="button" disabled={!canManage}>
      collect
    </button>
  ),
}));

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

const show = (
  lineage = lineageFixture(),
  locale: "en" | "ru" = "en",
  extra: { canManage?: boolean; reelCard?: React.ReactNode } = {},
) => {
  const messages = locale === "en" ? en : ru;
  return render(
    <I18nProvider locale={locale} messages={messages}>
      <LineageView
        lineage={lineage}
        t={messages.lineage}
        locale={locale}
        canManage={extra.canManage ?? true}
        reelCard={extra.reelCard}
      />
    </I18nProvider>,
  );
};
const section = (name: string) => screen.getByRole("region", { name });

describe("LineageView", () => {
  it("shows the post, its day-7 numbers and the snapshot table", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("¿Lavas el arroz");
    expect(screen.getByRole("link", { name: /Open on Instagram/ }).getAttribute("href")).toBe(
      "https://www.instagram.com/p/EXAMPLE/",
    );
    const numbers = section(en.lineage.numbers.title);
    expect(within(numbers).getByText(en.lineage.numbers.d7)).toBeTruthy();
    expect(
      within(numbers).getByRole("group", { name: en.lineage.numbers.reach }).textContent,
    ).toContain("2,400");
    expect(
      within(numbers).getByRole("group", { name: en.lineage.numbers.engagementRate }).textContent,
    ).toContain("11.8%");
    // One row per snapshot, with its real age.
    const slots = ["H2", "D1", "D3", "D7"];
    expect(slots.map((s) => numbers.querySelectorAll(`tr[data-slot="${s}"]`).length)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(within(numbers).getByText("24.4 h")).toBeTruthy();
  });

  it("says so when the day-7 numbers are from an earlier snapshot", () => {
    const lineage = lineageFixture();
    if (lineage.metrics.d7) {
      lineage.metrics.d7 = { ...lineage.metrics.d7, isExactD7: false, slot: "D3", ageHours: 72.3 };
    }
    show(lineage);
    expect(within(section(en.lineage.numbers.title)).getByText(/D3.*3/)).toBeTruthy();
    expect(screen.queryByText(en.lineage.numbers.d7)).toBeNull();
  });

  it("shows a dash for a metric Instagram did not return, never a zero", () => {
    const lineage = lineageFixture();
    if (lineage.metrics.d7)
      lineage.metrics.d7 = { ...lineage.metrics.d7, shares: null, shareRate: null };
    show(lineage);
    const numbers = section(en.lineage.numbers.title);
    expect(
      within(numbers).getByRole("group", { name: en.lineage.numbers.shares }).textContent,
    ).toContain("—");
    expect(
      within(numbers).getByRole("group", { name: en.lineage.numbers.shareRate }).textContent,
    ).toContain("—");
  });

  it("has a no-numbers state for a post that was never measured", () => {
    const lineage = lineageFixture();
    lineage.metrics = { d7: null, timeline: [] };
    show(lineage);
    expect(screen.getByText(en.lineage.numbers.none)).toBeTruthy();
    expect(document.querySelector('tr[data-slot="D7"]')).toBeNull();
  });

  it("lists the chain: cards with their source, idea, brief, version and review history", () => {
    show();
    const cards = section(en.lineage.chain.sources);
    expect(within(cards).getByText("Do not rinse risotto rice")).toBeTruthy();
    expect(within(cards).getByText(/rice chapter, page 41/)).toBeTruthy();
    expect(within(cards).getByText(/Arborio is never rinsed/)).toBeTruthy();
    expect(
      within(section(en.lineage.chain.idea)).getByText("Risotto rice is not rinsed"),
    ).toBeTruthy();
    expect(
      within(section(en.lineage.chain.adaptation)).getByText(/Spanish home cooks/),
    ).toBeTruthy();
    const version = section(en.lineage.chain.version);
    expect(within(version).getByText(/Version 2, approved by Sergey/)).toBeTruthy();
    expect(within(version).getByText(/#arroz #cocina/)).toBeTruthy();
    const events = [...document.querySelectorAll("[data-event]")].map((e) =>
      e.getAttribute("data-event"),
    );
    expect(events).toEqual(["EDIT", "REGENERATE", "APPROVE"]);
    expect(within(section(en.lineage.chain.generation)).getByText(/7 model runs/)).toBeTruthy();
  });

  it("has an empty state for a post without cards, brief, history or generation", () => {
    const lineage = lineageFixture();
    lineage.cards = [];
    lineage.brief = null;
    lineage.reviewHistory = [];
    lineage.generation = { runs: 0, costUsd: null, byStage: [] };
    show(lineage);
    expect(screen.getByText(en.lineage.chain.noCards)).toBeTruthy();
    expect(screen.getByText(en.lineage.chain.noBrief)).toBeTruthy();
    expect(screen.getByText(en.lineage.chain.noReview)).toBeTruthy();
    expect(screen.getByText(en.lineage.chain.noGeneration)).toBeTruthy();
  });

  it("links a Reel to its source carousel's review page, and a carousel to its Reels", () => {
    const reel = lineageFixture();
    reel.variant = { ...reel.variant, format: "REEL", sourceVariantId: "src" };
    reel.version = { ...reel.version, videoUrl: "https://storage.example/reel.mp4" };
    const { container } = show(reel);
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "https://storage.example/reel.mp4",
    );
    expect(screen.getByRole("link", { name: en.lineage.chain.openReel }).getAttribute("href")).toBe(
      `/content/review/${reel.idea.id}`,
    );
    cleanup();

    const carousel = lineageFixture();
    carousel.variant = {
      ...carousel.variant,
      reels: [{ variantId: "r1", status: "READY_FOR_REVIEW" }],
    };
    show(carousel, "en", { reelCard: <div data-testid="reel-card">Reel card</div> });
    expect(screen.getByTestId("reel-card")).toBeTruthy();
    expect(
      within(section(en.lineage.chain.relatedReel)).getByText(/READY_FOR_REVIEW/),
    ).toBeTruthy();
  });

  it("shows a post that is not published without a link", () => {
    const lineage = lineageFixture();
    lineage.publication = { ...lineage.publication, permalink: null, publishedAt: null };
    show(lineage);
    expect(screen.queryByRole("link", { name: /Open on Instagram/ })).toBeNull();
    expect(screen.getByText(en.lineage.notPublished)).toBeTruthy();
  });

  it("disables the collect button for a role that cannot manage", () => {
    show(lineageFixture(), "en", { canManage: false });
    expect((screen.getByRole("button", { name: "collect" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("renders in Russian", () => {
    show(lineageFixture(), "ru");
    expect(section(ru.lineage.numbers.title)).toBeTruthy();
    expect(section(ru.lineage.chain.sources)).toBeTruthy();
    expect(screen.getByRole("link", { name: new RegExp(ru.lineage.openOnInstagram) })).toBeTruthy();
  });
});

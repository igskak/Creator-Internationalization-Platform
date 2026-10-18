// @vitest-environment jsdom
import type { SystemHealth } from "@rc/modules/health";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { ru } from "@/lib/i18n/ru";
import { HealthReport, HealthTiles, INDICATORS } from "./health-view";

// H-01: the dashboard tiles and /settings/health say each state in words, link into the right
// section and to the stuck items, and show the kill switch under Publishing.

afterEach(cleanup);

const at = new Date("2026-10-10T12:00:00Z");

const health = (over: Partial<SystemHealth> = {}): SystemHealth => ({
  checkedAt: at,
  overall: "RED",
  connectivity: {
    state: "GREEN",
    db: { ok: true, ms: 12, configured: true },
    storage: { ok: true, ms: 80, configured: true },
  },
  instagram: {
    state: "AMBER",
    accounts: [
      {
        marketId: "m-es",
        marketCode: "es-ES",
        marketName: "Spain",
        flagEmoji: "🇪🇸",
        username: null,
        state: "NONE",
        reason: "NOT_CONNECTED",
        daysLeft: null,
        quota: null,
        lastCheckAt: null,
      },
      {
        marketId: "m-en",
        marketCode: "en",
        marketName: "English",
        flagEmoji: "🇬🇧",
        username: "chef_en",
        state: "AMBER",
        reason: "EXPIRING",
        daysLeft: 9,
        quota: { used: 3, total: 100 },
        lastCheckAt: at,
      },
    ],
  },
  publishing: {
    state: "RED",
    mode: "live",
    enabled: true,
    failed7d: 1,
    waiting: 0,
    lastFailure: { publicationId: "p-1", ideaId: "idea-1", at, message: "Media not ready." },
  },
  jobs: {
    state: "RED",
    failed24h: { INGESTION: 0, GENERATION: 2, PICTURES: 0, RENDERS: 0, PUBLISHING: 1 },
    stuck: [
      { kind: "SOURCE_PROCESSING", id: "s-1", since: at, sourceId: "s-1" },
      { kind: "VARIANT_GENERATING", id: "v-1", since: at, ideaId: "idea-2", marketCode: "en" },
    ],
  },
  insights: {
    state: "AMBER",
    due: 1,
    oldestLagHours: 6.2,
    late: [{ kind: "POST", id: "p-2", label: "D1", dueAt: at, lagHours: 6.2, marketCode: "en" }],
  },
  aiProviders: { state: "GREEN", runs: 12, failed: 0, refused: 0, invalid: 0 },
  aiCost: { state: "NONE", monthToDateUsd: 4.5, budgetUsd: null, share: null },
  problems: [
    {
      id: 1,
      integration: "instagram",
      severity: "WARN",
      code: "HEALTH_CHECK_FAILED",
      message: "The health check of @chef_en failed.",
      occurredAt: at,
    },
  ],
  activity: [
    {
      id: 7,
      action: "publication.failed",
      entityType: "publication",
      entityId: "p-1",
      actorType: "JOB",
      occurredAt: at,
    },
  ],
  ...over,
});

describe("HealthTiles", () => {
  it("has one tile per indicator with its state in words and a link to its section", () => {
    render(<HealthTiles health={health()} t={en.systemHealth} locale="en" />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      INDICATORS.map((k) => `/settings/health#${k}`),
    );
    const publishing = screen.getByText("Publishing").closest("a") as HTMLElement;
    expect(within(publishing).getByText("Problem")).toBeTruthy();
    expect(within(publishing).getByText(/Failed live posts, last 7 days: 1/)).toBeTruthy();
    const instagram = screen.getByText("Instagram accounts").closest("a") as HTMLElement;
    expect(within(instagram).getByText("Needs a look")).toBeTruthy();
    expect(
      within(instagram).getByText("🇪🇸 No account connected · 🇬🇧 Token ends in 9 days"),
    ).toBeTruthy();
    const cost = screen.getByText("AI cost").closest("a") as HTMLElement;
    expect(within(cost).getByText("Not in use")).toBeTruthy();
    expect(within(cost).getByText(/No monthly budget set/)).toBeTruthy();
  });

  it("speaks Russian", () => {
    render(<HealthTiles health={health()} t={ru.systemHealth} locale="ru" />);
    expect(screen.getByText("Фоновая работа")).toBeTruthy();
    expect(screen.getAllByText("Проблема").length).toBe(2);
    expect(screen.getByText("Сбои за 24 ч: 3 · Зависло: 2")).toBeTruthy();
  });
});

describe("HealthReport", () => {
  it("shows the details, links stuck items and late snapshots, and holds the kill switch", () => {
    render(
      <HealthReport
        health={health()}
        t={en.systemHealth}
        locale="en"
        killSwitch={<button type="button">Kill switch</button>}
      />,
    );
    const jobs = screen.getByRole("region", { name: "Background work" });
    expect(within(jobs).getByText(/Draft generating for more than 30 min · en/)).toBeTruthy();
    const opens = within(jobs).getAllByRole("link", { name: "Open" });
    expect(opens.map((l) => l.getAttribute("href"))).toEqual([
      "/knowledge/sources/s-1",
      "/content/review/idea-2",
    ]);
    const publishing = screen.getByRole("region", { name: "Publishing" });
    expect(within(publishing).getByText(/Media not ready\./)).toBeTruthy();
    expect(
      within(publishing).getByRole("link", { name: "Open the post" }).getAttribute("href"),
    ).toBe("/content/review/idea-1");
    expect(within(publishing).getByRole("button", { name: "Kill switch" })).toBeTruthy();
    const insights = screen.getByRole("region", { name: "Insights freshness" });
    expect(within(insights).getByText(/Post, slot D1 · en · 6 h late/)).toBeTruthy();
    expect(within(insights).getByRole("link").getAttribute("href")).toBe("/content/published/p-2");
    expect(screen.getByText(/HEALTH_CHECK_FAILED/)).toBeTruthy();
    expect(screen.getByText("publication.failed")).toBeTruthy();
    // Every section states its rule.
    expect(screen.getByText(/red after 24 hours/)).toBeTruthy();
  });

  it("says when nothing is stuck, due or open", () => {
    render(
      <HealthReport
        health={health({
          overall: "GREEN",
          jobs: {
            state: "GREEN",
            failed24h: { INGESTION: 0, GENERATION: 0, PICTURES: 0, RENDERS: 0, PUBLISHING: 0 },
            stuck: [],
          },
          insights: { state: "GREEN", due: 0, oldestLagHours: null, late: [] },
          problems: [],
          activity: [],
        })}
        t={en.systemHealth}
        locale="en"
      />,
    );
    expect(screen.getByText("Nothing is stuck.")).toBeTruthy();
    expect(screen.getByText("No snapshot is due.")).toBeTruthy();
    expect(screen.getByText("No open finding.")).toBeTruthy();
    expect(screen.getByText("Nothing yet.")).toBeTruthy();
  });
});

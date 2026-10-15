// @vitest-environment jsdom
import type { AiCostOverview } from "@rc/modules/ai";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { AiOverview } from "./ai-overview";

// /settings/ai (H-05): the budget state in words, the cost by stage, the stage table, the budget
// form for owners.

const setSetting = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/settings", () => ({ setAppSetting: setSetting }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const overview = (over: Partial<AiCostOverview> = {}): AiCostOverview => ({
  month: "2026-10",
  monthToDateUsd: 86.5,
  budgetUsd: 100,
  share: 0.865,
  state: "AMBER",
  byStage: [
    { stage: "CONTENT_WRITING", runs: 40, failed: 1, costUsd: 52.1 },
    { stage: "REEL_SHOT", runs: 12, failed: 0, costUsd: 30.4 },
  ],
  stages: [
    {
      stage: "CONTENT_WRITING",
      promptId: "content-writer",
      version: 5,
      model: "claude-opus-5-5",
      effort: "high",
      maxTokens: 16000,
    },
  ],
  last24h: { runs: 9, failed: 0, refused: 1, invalid: 0 },
  ...over,
});

function show(o: AiCostOverview, isOwner = true, locale: "en" | "ru" = "en") {
  const messages = locale === "en" ? en : ru;
  return render(
    <I18nProvider locale={locale} messages={messages}>
      <AiOverview overview={o} isOwner={isOwner} t={messages.aiSettings} locale={locale} />
    </I18nProvider>,
  );
}

describe("AiOverview", () => {
  it("says the budget state in words and shows the month by stage", () => {
    show(overview());
    const budget = screen.getByTestId("ai-budget");
    expect(within(budget).getByText("80 % reached")).toBeInTheDocument();
    expect(within(budget).getByText("$86.50")).toBeInTheDocument();
    expect(within(budget).getByText("of $100.00")).toBeInTheDocument();
    expect(within(budget).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "87");
    expect(within(screen.getByTestId("cost-by-stage")).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("content-writer@5")).toBeInTheDocument();
    expect(screen.getByText(/Last 24 hours: 9 runs, 0 failed, 1 refused/)).toBeInTheDocument();
  });

  it("saves a new budget (owners)", async () => {
    const user = userEvent.setup();
    setSetting.mockResolvedValue({ ok: true, data: { key: "ai.monthly_budget_usd", value: 150 } });
    show(overview());
    const input = screen.getByLabelText("Budget in USD a month (0 = none)");
    await user.clear(input);
    await user.type(input, "150");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith({ key: "ai.monthly_budget_usd", value: 150 }),
    );
  });

  it("shows no form to an editor and explains a missing budget, in Russian too", () => {
    show(overview({ budgetUsd: null, share: null, state: "NONE", byStage: [] }), false, "ru");
    expect(screen.getByText("Бюджет не задан: нет предупреждений и писем.")).toBeInTheDocument();
    expect(screen.getByText("Бюджет меняют только владельцы.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText("В этом месяце вызовов моделей и видео ещё не было."),
    ).toBeInTheDocument();
  });
});

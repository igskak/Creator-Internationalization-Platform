// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { summaryFixture } from "./fixtures";
import { SummaryTab } from "./summary";

// The Learning summary tab (M7-03) on a stored summary: patterns with lift and confidence, the
// lists, the caveats, the empty state, the button, both languages.

const actions = vi.hoisted(() => ({ buildPerformanceSummaryAction: vi.fn() }));
vi.mock("@/server/actions/analytics", () => actions);
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const labels = {
  value: (_dimension: string, value: string) =>
    ({
      QUESTION: "Question",
      LIST: "List",
      EVENING: "Evening",
      GRAINS_RICE_PASTA: "Rice and pasta",
      SAUCES: "Sauces",
      COMMON_MISTAKE: "Common mistake",
    })[value] ?? value,
};

function show(opts: { empty?: boolean; canBuild?: boolean; locale?: "en" | "ru" } = {}) {
  const locale = opts.locale ?? "en";
  const messages = locale === "en" ? en : ru;
  return render(
    <I18nProvider locale={locale} messages={messages}>
      <SummaryTab
        summary={opts.empty ? null : summaryFixture()}
        canBuild={opts.canBuild ?? true}
        labels={labels}
        reasonLabels={{ WEAK_HOOK: "Weak hook" }}
        t={messages.analytics}
        locale={locale}
      />
    </I18nProvider>,
  );
}

describe("Learning summary", () => {
  it("shows what did better and worse with lift, metric and confidence", () => {
    show();
    const top = screen.getByTestId("top-patterns");
    expect(within(top).getByText("Question")).toBeInTheDocument();
    expect(within(top).getByText("1.67× the market · save rate")).toBeInTheDocument();
    expect(within(top).getByText("7 posts · medium confidence")).toBeInTheDocument();
    expect(within(top).getByText("1.3× the market · share rate")).toBeInTheDocument();
    expect(within(screen.getByTestId("weak-patterns")).getByText("List")).toBeInTheDocument();
    expect(screen.getByText(/from 24 posts with numbers at day 7/)).toBeInTheDocument();
  });

  it("lists overuse, gaps, untested ideas, offers, feedback and the caveats", () => {
    show();
    expect(screen.getByText("5 approved in 21 days")).toBeInTheDocument();
    expect(screen.getByText("9 approved cards")).toBeInTheDocument();
    expect(screen.getByText("Bright daylight photos (visual style BRIGHT)")).toBeInTheDocument();
    expect(screen.getByText("priority 7 · 12 leads, 3 sales")).toBeInTheDocument();
    expect(screen.getByText("Weak hook")).toBeInTheDocument();
    expect(screen.getByText("Nunca laves el arroz del risotto")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Read with care" })).toHaveTextContent(
      "patterns are directional",
    );
  });

  it("starts a build with the button", async () => {
    const user = userEvent.setup();
    actions.buildPerformanceSummaryAction.mockResolvedValue({ ok: true, data: { runId: "run_1" } });
    show();
    await user.click(screen.getByRole("button", { name: "Build now" }));
    await waitFor(() => expect(actions.buildPerformanceSummaryAction).toHaveBeenCalledWith({}));
    expect(screen.getByRole("button", { name: "Build now" })).toBeDisabled();
  });

  it("explains when there is no summary, without the button for a chef, in Russian too", () => {
    show({ empty: true, canBuild: false, locale: "ru" });
    expect(screen.getByText(/Сводки пока нет/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

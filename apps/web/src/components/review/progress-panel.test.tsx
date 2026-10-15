// @vitest-environment jsdom
import type { DraftProgress, ProgressStep } from "@rc/modules/content";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { pollDelay } from "@/lib/progress-model";
import { formatDuration, ProgressPanel } from "./progress-panel";
import { ReviewProgressProvider } from "./progress-state";

// The progress panel and its provider (M6-10): every state of the steps, the time and the usual
// time, "taking longer than usual", and the poll: it stops at done, waits while the tab is hidden
// and slows down. Synthetic data only.

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), progress: vi.fn() }));
vi.mock("next/navigation", () => {
  const router = { refresh: (...args: unknown[]) => mocks.refresh(...args) };
  return { useRouter: () => router };
});
vi.mock("@/server/actions/progress", () => ({
  getProgress: mocks.progress,
  getActivity: vi.fn(),
}));

const ID = "11111111-1111-4111-8111-111111111111";
const IDEA = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-15T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  // By default the poll finds the draft still running.
  mocks.progress.mockReset();
  mocks.progress.mockImplementation(async () => ({ ok: true, data: [progress()] }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const STEP_KEYS = ["ADAPT", "WRITE", "CRITIC", "VISUAL", "PICTURES", "RENDER"] as const;
const steps = (...states: ProgressStep["state"][]): ProgressStep[] =>
  STEP_KEYS.map((key, i) => ({ key, state: states[i] ?? "todo" }));

const progress = (over: Partial<DraftProgress> = {}): DraftProgress => ({
  variantId: ID,
  marketCode: "es-ES",
  status: "GENERATING",
  phase: "running",
  steps: steps("done", "current"),
  startedAt: new Date(NOW - 130_000).toISOString(),
  lastProgressAt: new Date(NOW - 20_000).toISOString(),
  stalled: false,
  error: null,
  ...over,
});

const show = (
  item: DraftProgress,
  extra: { usualMs?: number | null; locale?: "en" | "ru"; hideError?: boolean } = {},
) => {
  const locale = extra.locale ?? "en";
  return render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : ru}>
      <ReviewProgressProvider
        ideaId={IDEA}
        initial={[item]}
        usualMs={extra.usualMs ?? null}
        shown={{ [item.variantId]: item.status }}
      >
        <ProgressPanel
          variantId={item.variantId}
          hideError={extra.hideError ?? false}
          fallback={<p>fallback</p>}
        />
      </ReviewProgressProvider>
    </I18nProvider>,
  );
};
const stateOf = (key: string) =>
  document.querySelector(`[data-step="${key}"]`)?.getAttribute("data-state");

describe("ProgressPanel", () => {
  it("running: ticks for finished steps, a spinner on the current one, the rest to come", async () => {
    show(progress({ steps: steps("done", "done", "current") }));
    await tick(0);
    const panel = screen.getByTestId("progress-panel");
    expect(panel.getAttribute("data-phase")).toBe("running");
    expect(STEP_KEYS.map(stateOf)).toEqual(["done", "done", "current", "todo", "todo", "todo"]);
    expect(within(panel).getByText(en.review.progress.steps.CRITIC)).toBeTruthy();
    expect(document.querySelector('[data-step="CRITIC"]')?.getAttribute("aria-current")).toBe(
      "step",
    );
  });

  it("shows the elapsed time, ticking each second, and the usual time", async () => {
    show(progress(), { usualMs: 240_000 });
    await tick(0);
    expect(screen.getByText(/Running for 2 min 10 s · usually about 4 min/)).toBeTruthy();
    await tick(5_000);
    expect(screen.getByText(/Running for 2 min 15 s/)).toBeTruthy();
  });

  it("shows no usual time when there is no history", async () => {
    show(progress(), { usualMs: null });
    await tick(0);
    expect(screen.queryByText(/usually/)).toBeNull();
  });

  it("queued: says it waits and has no timer", async () => {
    show(progress({ phase: "queued", status: "DRAFT", steps: steps(), startedAt: null }));
    await tick(0);
    expect(screen.getByText(en.review.progress.queued)).toBeTruthy();
    expect(screen.queryByText(/Running for/)).toBeNull();
    expect(screen.queryByText(en.review.progress.stalled)).toBeNull();
  });

  it("stalled: says it takes longer than usual and links to Health instead of spinning on", async () => {
    show(progress({ stalled: true }));
    await tick(0);
    const panel = screen.getByTestId("progress-panel");
    expect(panel.getAttribute("data-stalled")).toBe("true");
    expect(within(panel).getByText(en.review.progress.stalled)).toBeTruthy();
    expect(
      within(panel)
        .getByRole("link", { name: en.review.progress.checkHealth })
        .getAttribute("href"),
    ).toBe("/settings/health");
  });

  it("queued and stalled: says the job has not started", async () => {
    show(
      progress({
        phase: "queued",
        status: "DRAFT",
        steps: steps(),
        startedAt: null,
        stalled: true,
      }),
    );
    await tick(0);
    expect(screen.getByText(en.review.progress.stalledQueued)).toBeTruthy();
  });

  it("failed: a red step with the plain error, once", async () => {
    show(
      progress({
        phase: "failed",
        status: "DRAFT",
        steps: steps("done", "failed"),
        startedAt: null,
        error: {
          code: "INVALID_OUTPUT",
          message: "The WRITE:0 step did not produce a valid answer.",
        },
      }),
    );
    await tick(0);
    expect(stateOf("WRITE")).toBe("failed");
    expect(screen.getByText(en.review.progress.failedHere)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("did not produce a valid answer");
    expect(screen.getByRole("heading", { name: en.review.progress.titleStopped })).toBeTruthy();
    expect(screen.queryByText(/Running for/)).toBeNull();
  });

  it("failed: leaves the message out when the page shows it already", async () => {
    show(
      progress({
        phase: "failed",
        status: "DRAFT",
        steps: steps("done", "failed"),
        error: { code: "X", message: "Already on the page." },
      }),
      { hideError: true },
    );
    await tick(0);
    expect(screen.queryByText("Already on the page.")).toBeNull();
    expect(stateOf("WRITE")).toBe("failed");
  });

  it("shows how many pictures are made and the rewrite the critic is on", async () => {
    show(
      progress({
        steps: [
          { key: "ADAPT", state: "done" },
          { key: "WRITE", state: "done" },
          { key: "CRITIC", state: "current", rewrite: 1 },
          { key: "VISUAL", state: "todo" },
          { key: "PICTURES", state: "todo", count: { done: 2, total: 5 } },
          { key: "RENDER", state: "todo" },
        ],
      }),
    );
    await tick(0);
    expect(screen.getByText("after rewrite 1")).toBeTruthy();
    expect(screen.getByText("2 of 5")).toBeTruthy();
  });

  it("shows nothing for a draft with nothing running, and the fallback outside a provider", async () => {
    const { container } = show(progress({ phase: "idle", status: "READY_FOR_REVIEW" }));
    await tick(0);
    expect(container.textContent).toBe("");
    cleanup();
    render(
      <I18nProvider locale="en" messages={en}>
        <ProgressPanel variantId={ID} fallback={<p>fallback</p>} />
      </I18nProvider>,
    );
    expect(screen.getByText("fallback")).toBeTruthy();
  });

  it("renders in Russian", async () => {
    show(progress({ steps: steps("done", "current") }), { locale: "ru", usualMs: 240_000 });
    await tick(0);
    expect(screen.getByText(ru.review.progress.steps.WRITE)).toBeTruthy();
    expect(screen.getByText(/Идёт 2 мин 10 с · обычно около 4 мин/)).toBeTruthy();
  });
});

describe("formatDuration", () => {
  const t = { minutes: "{n} min", seconds: "{n} s" };
  it("is seconds under a minute, minutes and seconds up to ten, then minutes", () => {
    expect(formatDuration(45_000, t)).toBe("45 s");
    expect(formatDuration(130_000, t)).toBe("2 min 10 s");
    expect(formatDuration(180_000, t)).toBe("3 min");
    expect(formatDuration(11 * 60_000 + 30_000, t)).toBe("11 min");
    expect(formatDuration(-5, t)).toBe("0 s");
  });
});

describe("the poll", () => {
  const running = progress();
  const done = progress({
    phase: "idle",
    status: "READY_FOR_REVIEW",
    steps: steps("done", "done", "done", "done", "done", "done"),
  });

  it("asks every three seconds while running, then stops and refreshes the page once at done", async () => {
    mocks.progress
      .mockResolvedValueOnce({ ok: true, data: [running] })
      .mockResolvedValueOnce({ ok: true, data: [done] });
    show(running);
    await tick(2_900);
    expect(mocks.progress).not.toHaveBeenCalled();
    await tick(200);
    expect(mocks.progress).toHaveBeenCalledTimes(1);
    expect(mocks.progress).toHaveBeenCalledWith({ ideaId: IDEA });
    await tick(3_100);
    expect(mocks.progress).toHaveBeenCalledTimes(2);
    // Settled: the panel is gone, the page data follows, and nothing asks any more.
    expect(screen.queryByTestId("progress-panel")).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await tick(60_000);
    expect(mocks.progress).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a draft that has nothing running", async () => {
    show(done);
    await tick(30_000);
    expect(mocks.progress).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not ask while the tab is hidden, and looks at once when it is shown again", async () => {
    mocks.progress.mockResolvedValue({ ok: true, data: [running] });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    show(running);
    await tick(30_000);
    expect(mocks.progress).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.progress).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("slows down the longer it watches", () => {
    expect(pollDelay(0)).toBe(3_000);
    expect(pollDelay(59_000)).toBe(3_000);
    expect(pollDelay(61_000)).toBe(5_000);
    expect(pollDelay(6 * 60_000)).toBe(10_000);
  });

  it("refreshes the page when the draft moved on to a status the page does not show", async () => {
    // Shown as queued (DRAFT); now it is GENERATING: the page has to learn it.
    const queued = progress({ phase: "queued", status: "DRAFT", steps: steps(), startedAt: null });
    mocks.progress.mockResolvedValue({ ok: true, data: [running] });
    show(queued);
    await tick(3_100);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    // The panel itself follows the poll without waiting for the page.
    expect(screen.getByTestId("progress-panel").getAttribute("data-phase")).toBe("running");
  });

  it("keeps asking after a failed call", async () => {
    mocks.progress
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, data: [running] });
    show(running);
    await tick(3_100);
    await tick(3_100);
    expect(mocks.progress).toHaveBeenCalledTimes(2);
  });
});

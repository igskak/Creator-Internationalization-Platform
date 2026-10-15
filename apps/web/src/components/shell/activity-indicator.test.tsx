// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ActivityIndicator } from "./activity-indicator";

const mocks = vi.hoisted(() => ({ activity: vi.fn() }));
vi.mock("@/server/actions/progress", () => ({ getActivity: mocks.activity, getProgress: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const show = (running: number) =>
  render(
    <I18nProvider locale="en" messages={en}>
      <ActivityIndicator running={running} />
    </I18nProvider>,
  );

describe("ActivityIndicator", () => {
  it("shows nothing and asks nothing while nothing runs", async () => {
    const { container } = show(0);
    await tick(60_000);
    expect(container.textContent).toBe("");
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("shows the count, follows it and disappears when the work is done", async () => {
    mocks.activity
      .mockResolvedValueOnce({ ok: true, data: { running: 1 } })
      .mockResolvedValueOnce({ ok: true, data: { running: 0 } });
    show(2);
    expect(screen.getByRole("status").textContent).toContain("In progress: 2");
    await tick(6_100);
    expect(screen.getByRole("status").textContent).toContain("In progress: 1");
    await tick(6_100);
    expect(screen.queryByRole("status")).toBeNull();
    await tick(60_000);
    expect(mocks.activity).toHaveBeenCalledTimes(2);
  });

  it("does not ask while the tab is hidden", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    show(1);
    await tick(30_000);
    expect(mocks.activity).not.toHaveBeenCalled();
    visibility.mockRestore();
  });

  it("takes a new count from the layout after a run is started", async () => {
    const { rerender } = show(0);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(
      <I18nProvider locale="en" messages={en}>
        <ActivityIndicator running={3} />
      </I18nProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("In progress: 3");
  });
});

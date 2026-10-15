// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { ReviewPoller } from "./review-poller";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), statuses: vi.fn() }));
// Like Next's: the same router object on every render.
vi.mock("next/navigation", () => {
  const router = { refresh: (...args: unknown[]) => mocks.refresh(...args) };
  return { useRouter: () => router };
});
vi.mock("@/server/actions/statuses", () => ({ getStatuses: mocks.statuses }));

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("ReviewPoller", () => {
  it("does nothing while nothing is in progress or rendering", async () => {
    render(<ReviewPoller variants={[{ id: ID, status: "READY_FOR_REVIEW", inProgress: false }]} />);
    await tick(10_000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.statuses).not.toHaveBeenCalled();
  });

  it("refreshes every three seconds, one after the other, while something is rendering", async () => {
    render(
      <ReviewPoller
        variants={[{ id: ID, status: "READY_FOR_REVIEW", inProgress: false, rendering: true }]}
      />,
    );
    await tick(2_900);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await tick(200);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await tick(3_100);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("stops after fifteen minutes", async () => {
    render(
      <ReviewPoller
        variants={[{ id: ID, status: "READY_FOR_REVIEW", inProgress: false, rendering: true }]}
      />,
    );
    // Step by step, so that React shows each refresh as finished before the next tick.
    for (let elapsed = 0; elapsed < 15 * 60_000 + 10_000; elapsed += 3_000) await tick(3_000);
    const calls = mocks.refresh.mock.calls.length;
    expect(calls).toBeGreaterThan(250);
    await tick(30_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(calls);
  });

  it("refreshes once when the status of a draft in progress changes", async () => {
    mocks.statuses.mockResolvedValue({
      ok: true,
      data: { [ID]: { status: "READY_FOR_REVIEW" } },
    });
    render(<ReviewPoller variants={[{ id: ID, status: "GENERATING", inProgress: true }]} />);
    await tick(3_100);
    expect(mocks.statuses).toHaveBeenCalledWith({ variantIds: [ID] });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while the status is the one the page shows", async () => {
    mocks.statuses.mockResolvedValue({ ok: true, data: { [ID]: { status: "GENERATING" } } });
    render(<ReviewPoller variants={[{ id: ID, status: "GENERATING", inProgress: true }]} />);
    await tick(9_100);
    expect(mocks.statuses).toHaveBeenCalledTimes(3);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

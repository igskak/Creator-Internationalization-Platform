import { describe, expect, it, vi } from "vitest";
import { failureTags, reportBudgetAlert } from "./sentry";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@sentry/node", () => ({ init: vi.fn(), captureException: vi.fn(), ...sentry }));

describe("failureTags", () => {
  it("tags task, run and request id, never the payload", () => {
    const tags = failureTags({
      taskId: "hello",
      runId: "run_1",
      payload: { payload: { name: "secret-ish" }, meta: { requestId: "req-9" } },
    });
    expect(tags).toEqual({ task_id: "hello", run_id: "run_1", request_id: "req-9" });
  });

  it("works without a request id", () => {
    expect(failureTags({ taskId: "hello", runId: "run_2", payload: undefined })).toEqual({
      task_id: "hello",
      run_id: "run_2",
    });
  });
});

describe("reportBudgetAlert (H-05)", () => {
  it("sends one Sentry message per month and level, with sums only", () => {
    reportBudgetAlert({
      state: "RED",
      alert: { level: "RED", month: "2026-10", monthToDateUsd: 105.5, budgetUsd: 100 },
    });
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "AI cost is over the monthly budget: $105.50 of $100.00 (2026-10)",
      expect.objectContaining({
        level: "error",
        fingerprint: ["ai-budget", "2026-10", "RED"],
        tags: { alert: "ai_budget", level: "RED", month: "2026-10" },
      }),
    );
  });

  it("stays quiet without an alert", () => {
    sentry.captureMessage.mockClear();
    reportBudgetAlert({ state: "GREEN", alert: null });
    reportBudgetAlert(undefined);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});

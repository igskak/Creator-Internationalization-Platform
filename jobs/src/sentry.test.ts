import { describe, expect, it } from "vitest";
import { failureTags } from "./sentry";

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

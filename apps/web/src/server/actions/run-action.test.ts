import {
  ConflictError,
  InvalidStateError,
  NotFoundError,
  PermanentError,
  RightsBlockedError,
  TransientError,
} from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import type { AppUser, ServiceContext } from "@rc/modules/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type ActionDefinition, type ActionDeps, runAction } from "./run-action";

const lines: string[] = [];
const logger = createLogger({
  service: "web",
  env: "test",
  level: "debug",
  destination: { write: (line: string) => void lines.push(line) },
});

const editor: AppUser = { id: "u-1", email: "e@example.com", displayName: null, role: "editor" };

function deps(overrides: Partial<ActionDeps> = {}): ActionDeps {
  return {
    requestId: async () => "req-1",
    currentUser: async () => editor,
    makeContext: async (user, requestId) =>
      ({ actor: { type: "USER", userId: user.id, role: user.role }, requestId }) as ServiceContext,
    logger: () => logger,
    ...overrides,
  };
}

const Input = z.object({ title: z.string().min(1) });

function action(
  handler: ActionDefinition<typeof Input, unknown>["handler"],
  roles?: ActionDefinition<typeof Input, unknown>["roles"],
) {
  return { name: "testAction", input: Input, handler, ...(roles ? { roles } : {}) };
}

describe("runAction", () => {
  it("returns the handler's data with a USER context carrying the request id", async () => {
    const handler = vi.fn(async (ctx: ServiceContext, input: { title: string }) => ({
      actor: ctx.actor,
      requestId: ctx.requestId,
      title: input.title,
    }));
    const result = await runAction(action(handler), { title: "Paella" }, deps());
    expect(result).toEqual({
      ok: true,
      data: {
        actor: { type: "USER", userId: "u-1", role: "editor" },
        requestId: "req-1",
        title: "Paella",
      },
    });
  });

  it("maps invalid input to VALIDATION with field errors and does not call the handler", async () => {
    const handler = vi.fn();
    const result = await runAction(action(handler), { title: "" }, deps());
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        requestId: "req-1",
        fieldErrors: { title: [expect.any(String)] },
      },
    });
  });

  it("refuses signed-out or refused users with UNAUTHENTICATED", async () => {
    const handler = vi.fn();
    const result = await runAction(
      action(handler),
      { title: "x" },
      deps({ currentUser: async () => null }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("refuses a role that is not listed with FORBIDDEN", async () => {
    const handler = vi.fn();
    const makeContext = vi.fn();
    const result = await runAction(
      action(handler, ["owner"]),
      { title: "x" },
      deps({ makeContext }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(makeContext).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN", requestId: "req-1" } });
  });

  it("allows any active user when no roles are given", async () => {
    const chef: AppUser = { ...editor, role: "chef" };
    const result = await runAction(
      action(async () => "ok"),
      { title: "x" },
      deps({ currentUser: async () => chef }),
    );
    expect(result).toEqual({ ok: true, data: "ok" });
  });

  it.each([
    [new NotFoundError("Variant not found."), "NOT_FOUND", "Variant not found."],
    [new ConflictError("Changed by Ana, reload."), "CONFLICT", "Changed by Ana, reload."],
    [new InvalidStateError(), "INVALID_STATE", "This action is not allowed in the current state."],
    [new RightsBlockedError(), "RIGHTS_BLOCKED", "The source rights do not allow this."],
    [
      new TransientError("429 from vendor", { rateLimited: true }),
      "RATE_LIMITED",
      "An external service is busy. Try again in a few minutes.",
    ],
    [
      new PermanentError("401 invalid key sk-123"),
      "EXTERNAL_ERROR",
      "An external service failed. Try again later.",
    ],
  ])("maps %s to its code without leaking internal messages", async (error, code, message) => {
    const result = await runAction(
      action(async () => {
        throw error;
      }),
      { title: "x" },
      deps(),
    );
    expect(result).toEqual({ ok: false, error: { code, message, requestId: "req-1" } });
  });

  it("maps unknown errors to INTERNAL and logs them with the request id", async () => {
    lines.length = 0;
    const result = await runAction(
      action(async () => {
        throw new Error("connection string postgresql://u:p@host/db");
      }),
      { title: "x" },
      deps(),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Try again or contact the team with the request id.",
        requestId: "req-1",
      },
    });
    const logged = lines.map((line) => JSON.parse(line)).find((l) => l.msg === "action failed");
    expect(logged).toMatchObject({ level: "error", action: "testAction", requestId: "req-1" });
  });

  it("reports only unexpected errors to error tracking, with the request id", async () => {
    const report = vi.fn();
    const crash = new Error("db connection reset");
    await runAction(
      action(async () => {
        throw crash;
      }),
      { title: "x" },
      deps({ report }),
    );
    await runAction(
      action(async () => {
        throw new ConflictError();
      }),
      { title: "x" },
      deps({ report }),
    );
    await runAction(
      action(async () => {
        throw new PermanentError("vendor 400");
      }),
      { title: "x" },
      deps({ report }),
    );
    await runAction(
      action(async () => "ok"),
      { title: "" },
      deps({ report }),
    );
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(crash, { action: "testAction", requestId: "req-1" });
  });

  it("lets framework control flow errors through", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    const rethrow = (error: unknown) => {
      if (error === redirect) throw error;
    };
    await expect(
      runAction(
        action(async () => {
          throw redirect;
        }),
        { title: "x" },
        deps({ rethrow }),
      ),
    ).rejects.toBe(redirect);
  });
});

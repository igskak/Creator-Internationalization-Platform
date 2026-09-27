import type { ErrorCode, FieldErrors } from "@rc/lib/errors";

// What every server action returns (plan 05 §5.1). Shared by server and client code.

export type ActionError = {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
  /** Shown to the user so a failure can be found in the logs. */
  requestId: string;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

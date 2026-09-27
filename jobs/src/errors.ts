import { isRetryable } from "@rc/lib/errors";
import { serializeError } from "@rc/lib/logging";
import { AbortTaskRunError } from "@trigger.dev/sdk";

/**
 * Plan 06 §6.1: TransientError and unknown errors are rethrown (Trigger.dev retries up to
 * maxAttempts); Permanent, Validation, InvalidState, RightsBlocked… abort without retry.
 */
export function classifyJobError(error: unknown): unknown {
  if (isRetryable(error)) return error;
  const { name, message } = serializeError(error);
  return new AbortTaskRunError(`${name}: ${message}`);
}

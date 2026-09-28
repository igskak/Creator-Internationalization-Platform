"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionError, ActionResult } from "@/lib/action-result";

export type UseActionOptions<T> = {
  /** Toast shown after success. */
  successMessage?: string;
  onSuccess?: (data: T) => void;
  onError?: (error: ActionError) => void;
  /** Default true. Set false when the form shows the error inline. */
  toastOnError?: boolean;
};

/** The server did not answer (network, deploy in progress, crash before the action ran). */
const UNREACHABLE: ActionError = {
  code: "INTERNAL",
  message: "Could not reach the server. Check your connection and try again.",
  requestId: "none",
};

/**
 * Calls a server action from a client component (plan 05 §5.1): tracks the pending state and
 * shows failures as a toast with the request id.
 */
export function useAction<I, T>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: UseActionOptions<T> = {},
) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const run = useCallback(
    (input: I) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          let result: ActionResult<T>;
          try {
            result = await action(input);
          } catch {
            result = { ok: false, error: UNREACHABLE };
          }
          const { successMessage, onSuccess, onError, toastOnError = true } = optionsRef.current;
          if (result.ok) {
            setError(null);
            if (successMessage) toast.success(successMessage);
            onSuccess?.(result.data);
          } else {
            setError(result.error);
            if (toastOnError) {
              toast.error(result.error.message, {
                description: `Request id: ${result.error.requestId}`,
              });
            }
            onError?.(result.error);
          }
          resolve(result);
        });
      }),
    [action],
  );

  return { run, pending, error, fieldErrors: error?.fieldErrors };
}

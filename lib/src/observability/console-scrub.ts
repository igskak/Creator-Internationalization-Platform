import { redact } from "../logging/redact";
import { scrubText } from "../logging/scrub";

// Safety net (plan 12 §12.7): frameworks print unhandled errors with console.error (Next.js does
// for route handlers and server components), bypassing our redacting logger. Scrub those too.

/** Returns console arguments with credentials removed; Errors become scrubbed copies. */
export function scrubConsoleArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "string") return scrubText(arg);
    if (arg instanceof Error) {
      const copy = new Error(scrubText(arg.message));
      copy.name = arg.name;
      if (arg.stack) copy.stack = scrubText(arg.stack);
      return copy;
    }
    if (arg !== null && typeof arg === "object") return redact(arg);
    return arg;
  });
}

type ConsoleLike = Pick<Console, "error" | "warn">;

/** Wraps console.error / console.warn once per process. */
export function installConsoleScrubber(target: ConsoleLike = console): void {
  const marker = "__rcScrubbed";
  if ((target.error as unknown as Record<string, unknown>)[marker]) return;
  for (const method of ["error", "warn"] as const) {
    const original = target[method].bind(target);
    const wrapped = (...args: unknown[]) => original(...scrubConsoleArgs(args));
    Object.defineProperty(wrapped, marker, { value: true });
    target[method] = wrapped;
  }
}

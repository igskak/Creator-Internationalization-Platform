import pino, { type DestinationStream, type Logger } from "pino";
import type { LOG_LEVELS } from "../env/schemas";
import { redact, serializeError } from "./redact";
import { scrubText } from "./scrub";

export type { Logger };

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LoggerOptions = {
  service: "web" | "jobs" | "cli";
  env: string;
  level?: LogLevel;
  /** Git SHA of the deployed build. */
  release?: string;
  /** Output stream; stdout by default. */
  destination?: DestinationStream;
};

/** Correlation fields from plan 12 §12.9, bound with childLogger(). */
export type LogContext = {
  requestId?: string;
  runId?: string;
  taskId?: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
  market?: string;
};

/**
 * JSON logger. Every log object, child binding and message passes through redact()/scrubText(),
 * so tokens, OAuth codes, presigned URL signatures, cookies and passwords never reach the output.
 * Log ids, sizes and token counts; never prompt or model text (plan 12 §12.7).
 */
export function createLogger(options: LoggerOptions): Logger {
  const base = { service: options.service, env: options.env, release: options.release };
  const logger = pino(
    {
      level: options.level ?? "info",
      base: redact(base) as Record<string, unknown>,
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      serializers: {
        msg: (msg: unknown) => (typeof msg === "string" ? scrubText(msg) : msg),
        err: (err: unknown) => (err instanceof Error ? serializeError(err) : err),
      },
      formatters: {
        level: (label) => ({ level: label }),
        log: (object) => redact(object) as Record<string, unknown>,
      },
    },
    // Synchronous stdout: serverless functions can exit before an async buffer is flushed.
    options.destination ?? pino.destination({ dest: 1, sync: true }),
  );
  return redactChildBindings(logger);
}

export function childLogger(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}

// pino resets formatters.bindings for every child, so child bindings would skip redaction.
// Wrap child() on each instance instead; children inherit from their parent, so re-wrap each one.
// The original pino child() is kept and always called with the current instance as `this`.
type ChildFn = (
  this: Logger,
  bindings: pino.Bindings,
  childOptions?: pino.ChildLoggerOptions,
) => Logger;

function redactChildBindings(
  logger: Logger,
  pinoChild = logger.child as unknown as ChildFn,
): Logger {
  const redactingChild = (bindings: pino.Bindings, childOptions?: pino.ChildLoggerOptions) =>
    redactChildBindings(
      pinoChild.call(logger, redact(bindings) as pino.Bindings, childOptions),
      pinoChild,
    );
  logger.child = redactingChild as unknown as Logger["child"];
  return logger;
}

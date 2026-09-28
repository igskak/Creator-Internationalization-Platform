// Direct imports (not ../logging/index): this runs in the browser too and must not pull in pino.
import { isSensitiveKey, redact } from "../logging/redact";
import { scrubText } from "../logging/scrub";

// Sentry `beforeSend` / `beforeSendTransaction` scrubber (plan 12 §12.7, §12.9). Structural types
// so web (@sentry/nextjs) and jobs (@sentry/node) share it without a Sentry dependency here.

type Obj = Record<string, unknown>;

export type ScrubbableEvent = {
  message?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, string>;
    cookies?: unknown;
    data?: unknown;
    env?: unknown;
  };
  exception?: { values?: { value?: string; stacktrace?: { frames?: { vars?: Obj }[] } }[] };
  breadcrumbs?: { message?: string; data?: Obj }[];
  extra?: Obj;
  contexts?: Obj;
  user?: Obj;
  tags?: Record<string, unknown>;
  transaction?: string;
};

/** Headers that are never sent (credentials, cookies, test secrets). */
const DROP_HEADERS =
  /^(cookie|set-cookie|authorization|proxy-authorization|x-e2e-secret|x-api-key)$/i;

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (DROP_HEADERS.test(name) || isSensitiveKey(name)) continue;
    out[name] = scrubText(String(value));
  }
  return out;
}

/**
 * Removes tokens, OAuth codes, presigned signatures, cookies and passwords from an event, keeps
 * only the user id, and copies the `x-request-id` header into the `request_id` tag.
 */
export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  const e = event;
  if (e.message) e.message = scrubText(e.message);
  if (e.transaction) e.transaction = scrubText(e.transaction);

  if (e.request) {
    const requestId = Object.entries(e.request.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "x-request-id",
    )?.[1];
    if (requestId) e.tags = { ...e.tags, request_id: requestId };
    if (e.request.url) e.request.url = scrubText(e.request.url);
    if (typeof e.request.query_string === "string") {
      e.request.query_string = scrubText(`?${e.request.query_string}`).slice(1);
    } else if (e.request.query_string !== undefined) {
      e.request.query_string = redact(e.request.query_string);
    }
    if (e.request.headers) e.request.headers = scrubHeaders(e.request.headers);
    delete e.request.cookies;
    delete e.request.env;
    if (e.request.data !== undefined) e.request.data = redact(e.request.data);
  }

  for (const value of e.exception?.values ?? []) {
    if (value.value) value.value = scrubText(value.value);
    for (const frame of value.stacktrace?.frames ?? []) {
      if (frame.vars) frame.vars = redact(frame.vars) as Obj;
    }
  }
  for (const crumb of e.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data) crumb.data = redact(crumb.data) as Obj;
  }
  if (e.extra) e.extra = redact(e.extra) as Obj;
  if (e.contexts) e.contexts = redact(e.contexts) as Obj;
  if (e.user) e.user = typeof e.user.id === "string" ? { id: e.user.id } : {};
  return e;
}

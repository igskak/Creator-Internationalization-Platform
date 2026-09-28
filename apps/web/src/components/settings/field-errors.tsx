import type { FieldErrors } from "@rc/lib/errors";

/** Messages for one field path, or for every path under a prefix (e.g. "visualSystem"). */
export function errorsFor(
  fieldErrors: FieldErrors | undefined,
  path: string,
  nested = false,
): string[] {
  if (!fieldErrors) return [];
  return Object.entries(fieldErrors)
    .filter(([key]) => key === path || (nested && key.startsWith(`${path}.`)))
    .flatMap(([key, messages]) =>
      key === path ? messages : messages.map((m) => `${key.slice(path.length + 1)}: ${m}`),
    );
}

export function FieldErrorText({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {messages.join(" · ")}
    </p>
  );
}

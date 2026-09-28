// Sentry 11 `dataCollection` (replaces `sendDefaultPii`). Collect the minimum; the scrubber
// (scrubSentryEvent) still runs on every event. Prompts and model outputs contain Reg.Chef source
// IP (plan 12 §12.7), so gen-AI inputs/outputs are never sent. A function, so each SDK gets its own
// mutable copy.
export function sentryDataCollection() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { allow: ["x-request-id", "user-agent", "referer", "content-type"] },
      response: false,
    },
    httpBodies: [],
    urlQueryParams: true,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
  };
}

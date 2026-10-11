/** How the header shows the state of publishing (plan 10 §10.1). */
export type PublishingIndicatorState = "off" | "paused" | "dryRun" | "live";

/**
 * The environment decides first: `off` publishes nothing, `dry_run_only` runs only dry runs. Inside
 * `live`, the owner's switch decides between paused and live.
 */
export function publishingIndicator(status: {
  mode: "off" | "dry_run_only" | "live";
  enabled: boolean;
}): PublishingIndicatorState {
  if (status.mode === "off") return "off";
  if (status.mode === "dry_run_only") return "dryRun";
  return status.enabled ? "live" : "paused";
}

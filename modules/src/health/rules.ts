// The thresholds of the health indicators (plan 12 §12.9, H-01). Pure: numbers in, a state out,
// so every rule is tested on its own. The state is never shown as colour alone: the screen says it
// in words next to the reason.

export type HealthState = "GREEN" | "AMBER" | "RED" | "NONE";

const RANK: Record<HealthState, number> = { NONE: 0, GREEN: 1, AMBER: 2, RED: 3 };

/** The worst of the states; NONE (not applicable) only when nothing else is there. */
export const worst = (states: readonly HealthState[]): HealthState =>
  states.reduce<HealthState>((w, s) => (RANK[s] > RANK[w] ? s : w), "NONE");

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Instagram: a token that ends within this many days is amber (12 §12.9). */
export const TOKEN_AMBER_DAYS = 14;
/** Instagram: publishing quota used above this share is amber. */
export const QUOTA_AMBER_SHARE = 0.8;
/** Publishing: a post that waits longer than this to start is amber. */
export const WAITING_AMBER_MS = 15 * 60_000;
/** Publishing: a FAILED publication within this window is red. */
export const PUBLISH_FAILURE_WINDOW_MS = 7 * DAY_MS;
/** Stuck detectors (12 §12.9). */
export const SOURCE_STUCK_MS = 2 * HOUR_MS;
export const GENERATING_STUCK_MS = 30 * 60_000;
export const RENDER_STUCK_MS = 30 * 60_000;
/** DB or storage slower than this is amber. */
export const SLOW_PROBE_MS = 2_000;

export type InstagramReason =
  | "OK"
  | "EXPIRING"
  | "QUOTA"
  | "NEEDS_REAUTH"
  | "REVOKED"
  | "NOT_CONNECTED"
  | "DISCONNECTED";

export function instagramState(input: {
  status: "ACTIVE" | "NEEDS_REAUTH" | "DISABLED" | "REVOKED" | null;
  tokenStatus: "VALID" | "EXPIRING" | "INVALID" | "REVOKED" | null;
  tokenExpiresAt: Date | null;
  quota: { used: number; total: number } | null;
  now: Date;
}): { state: HealthState; reason: InstagramReason } {
  if (input.status === null) return { state: "NONE", reason: "NOT_CONNECTED" };
  if (input.status === "REVOKED" || input.tokenStatus === "REVOKED") {
    return { state: "RED", reason: "REVOKED" };
  }
  if (input.status === "DISABLED") return { state: "NONE", reason: "DISCONNECTED" };
  const left = input.tokenExpiresAt ? input.tokenExpiresAt.getTime() - input.now.getTime() : null;
  if (
    input.status === "NEEDS_REAUTH" ||
    input.tokenStatus === "INVALID" ||
    (left !== null && left <= 0)
  ) {
    return { state: "RED", reason: "NEEDS_REAUTH" };
  }
  if (input.tokenStatus === "EXPIRING" || (left !== null && left <= TOKEN_AMBER_DAYS * DAY_MS)) {
    return { state: "AMBER", reason: "EXPIRING" };
  }
  if (
    input.quota &&
    input.quota.total > 0 &&
    input.quota.used / input.quota.total > QUOTA_AMBER_SHARE
  ) {
    return { state: "AMBER", reason: "QUOTA" };
  }
  return { state: "GREEN", reason: "OK" };
}

export function publishingState(input: {
  enabled: boolean;
  failed7d: number;
  waiting: number;
}): HealthState {
  if (input.failed7d > 0) return "RED";
  if (!input.enabled || input.waiting > 0) return "AMBER";
  return "GREEN";
}

export function jobsState(input: { failed24h: number; stuck: number }): HealthState {
  if (input.failed24h >= 3 || input.stuck > 0) return "RED";
  if (input.failed24h > 0) return "AMBER";
  return "GREEN";
}

/** Insights freshness by how late the oldest due snapshot is (null: nothing due). */
export function insightsState(oldestLagHours: number | null): HealthState {
  if (oldestLagHours === null || oldestLagHours < 3) return "GREEN";
  if (oldestLagHours <= 24) return "AMBER";
  return "RED";
}

export function aiProvidersState(input: {
  runs: number;
  failed: number;
  refused: number;
  invalid: number;
}): HealthState {
  if (input.runs === 0) return "GREEN";
  if (input.failed / input.runs > 0.2) return "RED";
  if ((input.refused + input.invalid) / input.runs > 0.05) return "AMBER";
  return "GREEN";
}

export type Probe = { ok: boolean; ms: number | null; configured: boolean };

export function probeState(probe: Probe): HealthState {
  if (!probe.configured) return "NONE";
  if (!probe.ok) return "RED";
  return probe.ms !== null && probe.ms > SLOW_PROBE_MS ? "AMBER" : "GREEN";
}

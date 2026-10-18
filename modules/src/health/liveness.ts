import { schema } from "@rc/db";
import { sql } from "@rc/db/orm";
import type { ServiceContext } from "../core";
import { type HealthState, type Probe, probeState, worst } from "./rules";

// The database and storage probes (plan 05 §5.11 `GET /api/health`, 12 §12.9 "DB / storage",
// H-01). Each probe is one cheap read: a one-row select, and a `head` of a key that need not
// exist (an answer, found or not, proves storage is reachable and the credentials work). Nothing
// is written, and the answer holds no secret and no error text.

/** A probe that does not answer within this time counts as failing. */
export const PROBE_TIMEOUT_MS = 5_000;
const STORAGE_PROBE_KEY = "health/probe";

async function timed(run: () => Promise<unknown>, now: () => number): Promise<Probe> {
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, ms: now() - started, configured: true };
  } catch {
    return { ok: false, ms: now() - started, configured: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkConnectivity(
  ctx: ServiceContext,
): Promise<{ db: Probe; storage: Probe }> {
  // Wall time, not the service clock: a probe measures real latency.
  const now = () => performance.now();
  const db = await timed(
    () => ctx.db.select({ one: sql<number>`1` }).from(schema.markets).limit(1),
    now,
  );
  const storage = await timed(() => ctx.storage.head(STORAGE_PROBE_KEY), now);
  if (!db.ok) ctx.logger.warn({ ms: db.ms }, "health probe: database failing");
  if (!storage.ok) ctx.logger.warn({ ms: storage.ms }, "health probe: storage failing");
  return {
    db: { ...db, ms: db.ms === null ? null : Math.round(db.ms) },
    storage: { ...storage, ms: storage.ms === null ? null : Math.round(storage.ms) },
  };
}

export type Liveness = {
  /** `down` when the database fails (the uptime check fails), `degraded` for slow or no storage. */
  status: "ok" | "degraded" | "down";
  version: string | null;
  checks: { db: HealthState; storage: HealthState };
};

/** The body of `GET /api/health`: states only, never error messages. */
export async function checkLiveness(
  ctx: ServiceContext,
  version: string | undefined,
): Promise<Liveness> {
  const { db, storage } = await checkConnectivity(ctx);
  const checks = { db: probeState(db), storage: probeState(storage) };
  const status =
    checks.db === "RED"
      ? "down"
      : worst([checks.db, checks.storage]) === "GREEN"
        ? "ok"
        : "degraded";
  return { status, version: version ? version.slice(0, 12) : null, checks };
}

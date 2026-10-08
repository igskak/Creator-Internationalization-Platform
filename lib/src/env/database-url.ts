import type { AppEnv } from "./schemas";

/**
 * The connection string the running app should use (plan 01 V-20). On a developer machine
 * (`APP_ENV=development`) it is the direct/session URL when one is set: the transaction pooler on
 * port 6543 stalls queued queries on some networks (a phone hotspot, for one), while the session
 * pooler on 5432 does not, and one local process cannot exhaust its connections. Every other
 * environment uses `DATABASE_URL` as it is. That must be the session pooler (port 5432) too:
 * on 2026-10-08 the transaction pooler (6543) was found to stall as soon as several queries run
 * at once, also from Vercel (decision log), so a page that loads eight lists hung for 300 s.
 */
export function runtimeDatabaseUrl(
  db: {
    url: string;
    directUrl: string | undefined;
  },
  appEnv: AppEnv,
): string {
  return appEnv === "development" && db.directUrl ? db.directUrl : db.url;
}

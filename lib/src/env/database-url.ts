import type { AppEnv } from "./schemas";

/**
 * The connection string the running app should use (plan 01 V-20). On a developer machine
 * (`APP_ENV=development`) it is the direct/session URL when one is set: the transaction pooler on
 * port 6543 stalls queued queries on some networks (a phone hotspot, for one), while the session
 * pooler on 5432 does not, and one local process cannot exhaust its connections. Every other
 * environment, serverless production above all, keeps the transaction pooler URL.
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

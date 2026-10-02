import { NotFoundError } from "@rc/lib/errors";

/** Dev-only pages and actions (M0-14a) exist only when `APP_ENV=development`. */
export function isDevToolsEnabled(appEnv: string): boolean {
  return appEnv === "development";
}

/** Refuses with NOT_FOUND outside development, so a dev action looks absent in production. */
export function assertDevTools(appEnv: string): void {
  if (!isDevToolsEnabled(appEnv)) throw new NotFoundError();
}

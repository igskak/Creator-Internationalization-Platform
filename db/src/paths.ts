import { fileURLToPath } from "node:url";

/** Absolute path of the drizzle migrations folder. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

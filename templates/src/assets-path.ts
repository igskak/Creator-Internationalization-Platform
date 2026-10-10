import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Where the bundled fonts and icons are (M3-06, M3-12). From source they sit next to this file's
// package (`../assets`). A bundled job (Trigger.dev) runs from another place, so the files are
// copied into the deployment (`additionalFiles` in jobs/trigger.config.ts) and looked up under
// the working directory too; `setAssetsRoot` pins the directory explicitly.

let override: string | undefined;

/** Pins the assets directory (the one that holds `fonts/` and `icons/`). */
export function setAssetsRoot(path: string | undefined): void {
  override = path;
}

const here = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

/** Absolute path of a file under `assets/`; throws with the places it looked in. */
export function assetPath(relative: string): string {
  const cwd = process.cwd();
  const roots = [
    ...(override ? [override] : []),
    here(),
    join(cwd, "templates", "assets"),
    join(cwd, "assets"),
    join(cwd, "..", "templates", "assets"),
    join(cwd, "..", "..", "templates", "assets"),
  ];
  for (const root of roots) {
    const candidate = join(root, relative);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Template asset "${relative}" not found in: ${roots.join(", ")}`);
}

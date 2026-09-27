import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { exports: Record<string, string> };

describe("@rc/modules subpath exports", () => {
  for (const [subpath, file] of Object.entries(manifest.exports)) {
    it(`${subpath} resolves to a module named after it`, async () => {
      const mod = (await import(new URL(`../${file}`, import.meta.url).href)) as {
        MODULE_NAME: string;
      };
      expect(`./${mod.MODULE_NAME}`).toBe(subpath);
    });
  }
});

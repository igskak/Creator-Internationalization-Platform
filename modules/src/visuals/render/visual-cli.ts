import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registry } from "@rc/templates";
import { TEMPLATE_FIXTURES } from "@rc/templates/fixtures";
import { buildTheme } from "@rc/templates/render";
import sharp from "sharp";
import { comparePng, MAX_DIFF_RATIO } from "./golden";
import { launchBrowser, renderSlidePng } from "./renderer";

// `pnpm test:visual [--update]` (plan 08 §8.9, M3-14): renders every fixture of every template and
// compares the PNG with its golden image in `templates/__golden__/<platform>/`. `--update` writes
// the goldens (review the changed images in the pull request). Actual and diff images of a
// failure go to `templates/__golden__/.actual/` (git-ignored; CI uploads them as an artifact).
// Goldens are per platform: Chromium on macOS and on Linux anti-aliases text differently.

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "templates",
  "__golden__",
);
const platformDir = join(root, process.platform);
const actualDir = join(root, ".actual");
const update = process.argv.includes("--update");

/** A fixed picture with a few flat blocks: small as a PNG and the same everywhere. */
async function picture(): Promise<string> {
  const block = (w: number, h: number, color: string) =>
    sharp({ create: { width: w, height: h, channels: 3, background: color } })
      .png()
      .toBuffer();
  const png = await sharp({
    create: { width: 540, height: 675, channels: 3, background: "#7a5b3a" },
  })
    .composite([
      { input: await block(540, 300, "#c9a46b"), left: 0, top: 0 },
      { input: await block(220, 220, "#efe2c4"), left: 160, top: 250 },
    ])
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function main(): Promise<number> {
  const browser = await launchBrowser();
  const theme = buildTheme({});
  const image = await picture();
  let failures = 0;
  let checked = 0;
  rmSync(actualDir, { recursive: true, force: true });
  mkdirSync(platformDir, { recursive: true });
  try {
    for (const [templateId, fixtures] of Object.entries(TEMPLATE_FIXTURES)) {
      const slots = Object.keys(registry.get(templateId)?.imageSlots ?? {});
      for (const [name, slide] of Object.entries(fixtures)) {
        // The PNG of the page, before the JPEG step, is what is compared.
        const images = Object.fromEntries(slots.map((slot) => [slot, image]));
        const png = await renderSlidePng(browser, { slide, assets: { images }, theme });
        const file = `${templateId}-${name}.png`;
        const goldenPath = join(platformDir, file);
        checked++;
        if (update) {
          writeFileSync(goldenPath, png);
          console.log(`updated ${process.platform}/${file}`);
          continue;
        }
        if (!existsSync(goldenPath)) {
          failures++;
          console.error(
            `MISSING golden ${process.platform}/${file} (run pnpm test:visual --update)`,
          );
          mkdirSync(actualDir, { recursive: true });
          writeFileSync(join(actualDir, file), png);
          continue;
        }
        const result = await comparePng(png, readFileSync(goldenPath));
        if (!result.ok) {
          failures++;
          console.error(
            `DIFF ${file}: ${result.diffPixels} pixels (${(result.ratio * 100).toFixed(3)} %, limit ${MAX_DIFF_RATIO * 100} %)`,
          );
          mkdirSync(actualDir, { recursive: true });
          writeFileSync(join(actualDir, file), png);
          if (result.diffPng)
            writeFileSync(join(actualDir, file.replace(".png", ".diff.png")), result.diffPng);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${checked} images ${update ? "written" : "checked"}, ${failures} failed.`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Slide, VisualBrief } from "@rc/db/json";
import { registry } from "@rc/templates";
import { buildTheme, type RenderAssets } from "@rc/templates/render";
import sharp from "sharp";
import { renderCarousel } from "./renderer";

// `pnpm --filter @rc/modules bench:carousel --post <post.json> --photos <dir> --out <dir>`: renders
// a stored carousel with the current templates, without the database or storage, to compare a
// template change on real pictures. `post.json` holds a variant's `slides_json` and
// `visual_brief_json` (a read-only dump); the photo folder holds `photo-<slideId>-<slot>.<ext>`.
// Writes one JPEG per slide, a contact sheet and the QA verdict; --cover white draws the white cover. Real content stays out of git:
// point --out at a git-ignored folder.

function arg(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

async function main(): Promise<void> {
  const post = JSON.parse(readFileSync(arg("post"), "utf8")) as {
    slides_json: Slide[];
    visual_brief_json?: VisualBrief | null;
  };
  const photosDir = arg("photos");
  const outDir = arg("out");
  const handle = process.argv.includes("--handle") ? arg("handle") : "chef.skk";
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(photosDir);
  const photo = (slideId: string, slot: string): string | undefined => {
    const name = files.find((f) => f.startsWith(`photo-${slideId}-${slot}.`));
    if (!name) return undefined;
    const mime = MIME[extname(name).toLowerCase()] ?? "image/png";
    return `data:${mime};base64,${readFileSync(join(photosDir, name)).toString("base64")}`;
  };
  const placements = new Map<string, Record<string, string>>();
  for (const entry of post.visual_brief_json?.slides ?? []) {
    if (!entry.placement) continue;
    placements.set(entry.slideId, {
      ...placements.get(entry.slideId),
      [entry.slot]: entry.placement,
    });
  }

  const slides = post.slides_json.map((slide) => {
    const images: Record<string, string> = {};
    const slots = new Set([
      ...Object.keys(slide.images ?? {}),
      ...Object.keys(registry.get(slide.templateId)?.imageSlots ?? {}),
    ]);
    for (const slot of slots) {
      const url = photo(slide.id, slot);
      if (url) images[slot] = url;
    }
    const placement = placements.get(slide.id);
    const assets: RenderAssets = placement
      ? { images, handle, placements: placement }
      : { images, handle };
    return { slide, assets };
  });

  // --cover white: the white cover of carousel v3 (D1) instead of the dark full-bleed one.
  const cover = process.argv.includes("--cover") ? arg("cover") : "dark";
  const result = await renderCarousel({ slides, theme: buildTheme({ cover }) });
  for (const s of result.slides) {
    writeFileSync(join(outDir, `slide-${String(s.index + 1).padStart(2, "0")}.jpg`), s.jpeg);
  }
  writeFileSync(
    join(outDir, "qa.json"),
    JSON.stringify(
      {
        verdict: result.verdict,
        qa: result.qa,
        pictures: (result.measurements ?? []).map((m) => ({
          slideId: m.slideId,
          pictures: m.pictures,
        })),
      },
      null,
      2,
    ),
  );

  // Contact sheet: four slides a row at 360 × 450.
  const cols = 4;
  const w = 360;
  const h = 450;
  const gap = 8;
  const rows = Math.ceil(result.slides.length / cols);
  const tiles = await Promise.all(
    result.slides.map(async (s, i) => ({
      input: await sharp(s.jpeg).resize(w, h).toBuffer(),
      left: gap + (i % cols) * (w + gap),
      top: gap + Math.floor(i / cols) * (h + gap),
    })),
  );
  await sharp({
    create: {
      width: gap + cols * (w + gap),
      height: gap + rows * (h + gap),
      channels: 3,
      background: "#9a9a9a",
    },
  })
    .composite(tiles)
    .jpeg({ quality: 88 })
    .toFile(join(outDir, "contact-sheet.jpg"));

  console.log(
    `${result.slides.length} slides → ${outDir}; ok=${result.verdict.ok}` +
      (result.verdict.problems.length ? `\nproblems: ${result.verdict.problems.join(" ")}` : "") +
      (result.verdict.warnings.length ? `\nwarnings: ${result.verdict.warnings.join(" ")}` : ""),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

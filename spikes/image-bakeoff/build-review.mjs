// M3-15 throwaway, step 3: builds the blind review page from ./out/results.json into the folder
// given as the first argument: index.html plus img/<n>-A.jpg and img/<n>-B.jpg (JPEG q92 of the
// PNGs, in the random A/B order of results.json). Model names stay out of the page.
// Usage: node spikes/image-bakeoff/build-review.mjs <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(join(here, "../../modules/package.json"))("sharp");
const target = process.argv[2];
if (!target) throw new Error("usage: build-review.mjs <outDir>");
mkdirSync(join(target, "img"), { recursive: true });

const rows = JSON.parse(readFileSync(join(here, "out/results.json"), "utf8"));
const pairs = [];
for (const row of rows) {
  const files = { A: row.results[row.blind.A]?.file, B: row.results[row.blind.B]?.file };
  if (!files.A || !files.B) {
    console.log(`skip #${row.n}: a model has no image`);
    continue;
  }
  for (const side of ["A", "B"]) {
    await sharp(join(here, "out", files[side]))
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(join(target, "img", `${row.n}-${side}.jpg`));
  }
  pairs.push({
    n: row.n,
    market: row.market,
    style: row.visualStyle,
    slot: row.slot,
    aspect: row.aspect,
    prompt: row.prompt,
  });
}
const template = readFileSync(join(here, "review.template.html"), "utf8");
const json = JSON.stringify(pairs).replace(/</g, "\\u003c");
writeFileSync(join(target, "index.html"), template.replace("/*PAIRS*/[]", json));
console.log(`${pairs.length} pairs → ${target}`);

// CV-05 spike (docs/design/carousel-v3-requirements.md, decision D2, option C): the final text
// slide is rendered first, then the image model paints the food into the slide's empty area with
// a mask, seeing the text it must compose around. Only the masked pixels are taken back, so the
// text stays exactly as rendered. Costs one image edit per slide.
//   tsx --env-file=<.env> spikes/carousel-v3/hybrid-edit.ts --slide <slide.jpg> --subject "<food>" --out <dir>
// Writes <out>/<name>-edit.png (the model's whole answer) and <out>/<name>-hybrid.jpg (the slide
// with only the masked area replaced) and prints the cost from `usage`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createRequire } from "node:module";

// sharp lives in the modules package (spikes are not a workspace package).
const sharp = createRequire(new URL("../../modules/package.json", import.meta.url))(
  "sharp",
) as typeof import("sharp");

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
};
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY is not set.");
const slidePath = arg("slide");
const subject = arg("subject");
const out = arg("out");
const model = process.argv.includes("--model") ? arg("model") : "gpt-image-2.5-sunburst";
mkdirSync(out, { recursive: true });
const name = basename(slidePath).replace(/\.[a-z]+$/i, "");

const W = 1080;
const H = 1350;
// The slide at 1024 × 1280 inside a 1024 × 1536 frame (an API size), white bands above and below.
const SW = 1024;
const SH = 1280;
const PAD = 128;

const slide = await sharp(slidePath).resize(W, H).removeAlpha().raw().toBuffer();
// Editable where no ink is within 44 px, right of x = 400 and between the margins.
const ink = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const v = ((slide[i * 3] ?? 255) + (slide[i * 3 + 1] ?? 255) + (slide[i * 3 + 2] ?? 255)) / 3;
  if (v < 235) ink[i] = 1;
}
const R = 44;
const near = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!ink[y * W + x]) continue;
    for (let dy = -R; dy <= R; dy += 4) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -R; dx <= R; dx += 4) {
        const xx = x + dx;
        if (xx >= 0 && xx < W) near[yy * W + xx] = 1;
      }
    }
  }
}
const editable = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    editable[y * W + x] = x >= 400 && y >= 80 && y < H - 90 && !near[y * W + x] ? 1 : 0;
  }
}
// Mask for the API: alpha 0 = paint here.
const maskSlide = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  maskSlide[i * 4 + 3] = editable[i] ? 0 : 255;
}
const toFrame = async (input: ReturnType<typeof sharp>, alpha: boolean) => {
  const body = await input.resize(SW, SH, { fit: "fill" }).png().toBuffer();
  return sharp({
    create: {
      width: SW,
      height: SH + 2 * PAD,
      channels: 4,
      background: alpha ? { r: 255, g: 255, b: 255, alpha: 1 } : "#ffffff",
    },
  })
    .composite([{ input: body, left: 0, top: PAD }])
    .png()
    .toBuffer();
};
const image = await toFrame(sharp(slidePath), false);
const mask = await toFrame(sharp(maskSlide, { raw: { width: W, height: H, channels: 4 } }), true);

const reuse = process.argv.includes("--reuse");
const form = new FormData();
form.append("model", model);
form.append("image", new Blob([image], { type: "image/png" }), "slide.png");
form.append("mask", new Blob([mask], { type: "image/png" }), "mask.png");
form.append(
  "prompt",
  `Add one realistic premium studio food photograph into the empty white area on the right side of this carousel slide: ${subject} The subject is whole, large and appetizing, placed to the right of and below the text and never touching it, on the same pure white seamless background (#FFFFFF), with soft high-key studio light and a soft natural shadow. Keep all existing text, its position and the white page exactly as they are. No new text.`,
);
form.append("size", "1024x1536");
form.append("quality", "high");
form.append("n", "1");
let usage: Record<string, unknown> = {};
let edited: Buffer;
if (reuse) {
  // --reuse: composite the edit already saved in <out>, without a new (paid) call.
  edited = readFileSync(join(out, `${name}-edit.png`));
} else {
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const json = (await response.json()) as {
    data?: { b64_json?: string }[];
    usage?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (!response.ok || !json.data?.[0]?.b64_json) {
    throw new Error(`images/edits ${response.status}: ${json.error?.message ?? "no image"}`);
  }
  usage = json.usage ?? {};
  edited = Buffer.from(json.data[0].b64_json, "base64");
  writeFileSync(join(out, `${name}-edit.png`), edited);
}

// Back to the slide: only the editable area, feathered, over the rendered slide.
const back = await sharp(edited)
  .extract({ left: 0, top: PAD, width: SW, height: SH })
  .resize(W, H, { fit: "fill" })
  .removeAlpha()
  .raw()
  .toBuffer();
const soft = await sharp(Buffer.from(editable.map((v) => v * 255)), {
  raw: { width: W, height: H, channels: 1 },
})
  .blur(6)
  .extractChannel(0)
  .raw()
  .toBuffer();
const result = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const a = (soft[i] ?? 0) / 255;
  for (let c = 0; c < 3; c++) {
    result[i * 3 + c] = Math.round((back[i * 3 + c] ?? 255) * a + (slide[i * 3 + c] ?? 255) * (1 - a));
  }
}
await sharp(result, { raw: { width: W, height: H, channels: 3 } })
  .jpeg({ quality: 90 })
  .toFile(join(out, `${name}-hybrid.jpg`));
console.log(`${name}: done; usage ${JSON.stringify(usage)}`);

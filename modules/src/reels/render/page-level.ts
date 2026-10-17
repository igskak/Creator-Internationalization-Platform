import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Exec } from "./exec";

// The page colour of an AI video shot (carousel v3 R2): one frame is taken, and the lower quarter of
// the light, neutral pixels of its outer ring (where the subject rarely is; light food such as
// bulgur or rice is coloured and left out) says how grey the "white" page came out. The same rule
// as the slide placement script (templates place-photo.ts).

/** 0–1: the page level of a raw RGB(A) frame; 1 when no light pixel is found on the ring. */
export function pageLevelOf(image: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}): number {
  const ringPx = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.04));
  const values: number[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const inside =
        x >= ringPx && x < image.width - ringPx && y >= ringPx && y < image.height - ringPx;
      if (inside) continue;
      const i = (y * image.width + x) * image.channels;
      const r = image.data[i] ?? 0;
      const g = image.data[i + 1] ?? 0;
      const b = image.data[i + 2] ?? 0;
      const v = (r + g + b) / 3;
      if (v > 170 && Math.max(r, g, b) - Math.min(r, g, b) <= 14) values.push(v);
    }
  }
  if (values.length === 0) return 1;
  values.sort((a, b) => a - b);
  return (values[Math.floor(values.length * 0.25)] ?? 255) / 255;
}

/** The page level of a clip from its frame at `seconds`; written next to the cards. */
export async function measureClipPageLevel(
  clipPath: string,
  seconds: number,
  tools: { exec: Exec; ffmpeg: string },
  workDir: string,
  name: string,
): Promise<number> {
  const dir = join(workDir, "pages");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${name}.png`);
  await tools.exec(tools.ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(Math.max(0, seconds)),
    "-i",
    clipPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=180:-2",
    out,
  ]);
  const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return pageLevelOf({ data, width: info.width, height: info.height, channels: info.channels });
}

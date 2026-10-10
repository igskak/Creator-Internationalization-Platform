import sharp from "sharp";

// Perceptual hash (plan 08 §8.4): a 64-bit difference hash. The picture is shrunk to 9 × 8 grey
// pixels and every pixel is compared with its right neighbour; the same picture re-encoded or
// resized gives the same or a nearby hash, another picture a distant one.

/** 16 hex characters. */
export async function perceptualHash(input: Uint8Array): Promise<string> {
  const pixels = await sharp(input)
    .rotate()
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x] ?? 0;
      const right = pixels[y * 9 + x + 1] ?? 0;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** Number of differing bits, 0–64. */
export function hammingDistance(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

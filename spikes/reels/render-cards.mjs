// Renders transparent 1080x1920 text cards (Inter Tight) inside the Reels safe zone.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("../../node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core");
const [specFile, outDir] = process.argv.slice(2);
const cards = JSON.parse(fs.readFileSync(specFile, "utf8"));
const font = pathToFileURL(path.resolve("../../templates/assets/fonts/inter-tight/inter-tight-latin-wght-normal.woff2")).href;
const css = `@font-face{font-family:IT;src:url("${font}");font-weight:100 900}
html,body{margin:0;background:transparent}
.w{width:1080px;height:1920px;position:relative;font-family:IT,sans-serif}
.t{position:absolute;left:70px;width:780px;font-weight:800;line-height:1.0;letter-spacing:-.02em;text-transform:uppercase;color:#111;
   paint-order:stroke fill;-webkit-text-stroke:14px rgba(255,255,255,.92)}
.t span{color:#E1251B}
.l{position:absolute;font-weight:800;font-size:46px;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#111;padding:12px 26px;border-radius:6px}`;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
fs.mkdirSync(outDir, { recursive: true });
for (const c of cards) {
  const body = [
    c.text ? `<div class="t" style="top:${c.top ?? 250}px;font-size:${c.size ?? 96}px">${c.text}</div>` : "",
    ...(c.labels ?? []).map((l) => `<div class="l" style="left:${l.x}px;top:${l.y}px">${l.t}</div>`),
  ].join("");
  await page.setContent(`<html><head><style>${css}</style></head><body><div class="w">${body}</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(outDir, `${c.id}.png`), omitBackground: true });
}
await browser.close();

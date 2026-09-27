# 08 · Visual rendering subsystem

Spec §23.1 item 8 (§23 item 8). Rule from [S§8]: AI makes visual assets; the app composes the final slide deterministically with HTML/CSS templates. The image model never renders typography.

## 8.1 Pipeline overview

```
content_variants.slides_json + visual_brief_json
        │
        ├─► generate-visual-assets (J7): ImageProvider → sharp normalize → R2 (assets/) → visual_assets
        │
        ▼
render-carousel (J8):
  1. input hash (slides + asset ids + theme variant + template versions) → reuse READY render if same
  2. glyph coverage check (fontkit)                          → MISSING_GLYPH (stop)
  3. for each slide: renderSlideHtml() → Chromium setContent → fonts ready → fit-text → overflow check
  4. screenshot PNG 1080×1350 → sharp → JPEG (sRGB, q90, 4:4:4) → R2 (renders/)
  5. QA report → carousel_renders READY → content_variants.current_render_id
```

## 8.2 Template representation (`templates/`)

```ts
export const templateA = defineTemplate({
  id: 'A', version: '1.0.0', name: 'Hero ingredient + strong hook',
  roles: ['HOOK'],
  textSlots: {
    kicker:   { maxChars: 24, maxLines: 1, required: false, font: 'display', minPx: 28, maxPx: 34 },
    headline: { maxChars: 70, maxLines: 3, required: true,  font: 'display', minPx: 64, maxPx: 96 },
    subline:  { maxChars: 90, maxLines: 2, required: false, font: 'body',    minPx: 32, maxPx: 38 },
  },
  imageSlots: { hero: { aspect: '4:5', required: true, fullBleed: true } },
  logo: { anchor: 'bottom-left', heightPx: 48 },
  component: TemplateA,     // React component: (props: SlideProps) => JSX
});
```
- The registry exports metadata for the writer prompt and validators (M2-03) and components for rendering (M3-07+). Slot limits are one source of truth for prompts, validators and the renderer.
- Template versions are part of the render input hash and of `generation_config.templatesVersion`.

### 8.2.1 Initial template library [S§8.1]

| Template | Roles | Text slots (max chars / lines) | Image slots | Priority |
|---|---|---|---|---|
| **A** Hero ingredient + strong hook | HOOK | kicker 24/1 (opt.), headline 70/3, subline 90/2 (opt.) | hero 4:5 full-bleed (required) | P0 |
| **B** Large number / fact + explanation | FACT, EXPLANATION, STEP, SUMMARY | number 8/1 (opt.), label 40/1 (opt.), headline 60/2 (opt.), body 220/6 | side 1:1 (opt.) | P0 |
| **E** Mistake vs correct technique | MISTAKE, CORRECT | mistakeTitle 40/1, mistakeText 140/4, correctTitle 40/1, correctText 140/4 | image 1:1 (opt.) | P0 |
| **F** CTA / lead magnet / offer | CTA | headline 60/2, body 160/4, keyword 16/1 (opt.), offerName 40/1 (opt.) | product 1:1 (opt.) | P0 |
| **C** Before vs after | COMPARISON | beforeLabel 20/1, afterLabel 20/1, caption 140/3 | before + after, half-height each (required) | P1 |
| **D** Diagram / mechanism | EXPLANATION, STEP | title 60/2, steps 3–5 × 60/2 | icon per step (from icon set), image (opt.) | P1 |

B without `number` becomes a headline + body slide, so every role has a P0 template. Limits are starting values; tune them with the first real renders (M3-08/09) and keep prompts in sync (same registry).

## 8.3 Theme and typography
- **Tokens** come from `brands.visual_system` (colors, fonts, logo, safe margin) plus a market theme variant (visual hypothesis, e.g. `warm-mediterranean` for Spain) [S§8.2]. Tokens become CSS variables on the slide root.
- **Canvas**: 1080 × 1350 px, safe margin 72 px, fixed logo anchor per template, page indicator `3/8` (24 px) bottom-right.
- **Fonts**: brand fonts if they are licensed for embedding (Track B B-10). Fallback: SIL OFL fonts with Latin Extended and Cyrillic coverage (a display serif + a sans, e.g. Fraunces + Inter). Files (WOFF2 for browsers, TTF for glyph checks) live in `templates/assets/fonts`. The renderer embeds fonts as data URLs; no system fonts, no network → identical output everywhere.
- **Sizes**: headline 64–96 px, body 32–44 px (minimum 32 px for phone legibility), line height 1.1–1.15 headline / 1.3 body. `text-wrap: balance` on headlines. No automatic hyphenation (dictionary support in headless Chromium is not reliable); the fit-text step shrinks text instead.
- **Emoji**: not allowed in slide text (validator), allowed in captions.

## 8.4 Images
- **Generation**: request the provider aspect closest to the slot (e.g. portrait 2:3 for a 4:5 slot) ⚠ V-19, with the visual director's prompt + negative prompt (no text, no logos, no packaging, no hands with deformed fingers).
- **Normalization** (`visuals/images/normalize.ts`): auto-orient, convert to sRGB, crop to slot aspect with `sharp` attention strategy (P1: manual focal point), resize to slot pixels (hero 1080×1350), encode WebP q90 for storage; keep the original in `original_key`.
- **Perceptual hash** of each image (P1 use: visual similarity ES vs EN).
- **Library photos** (P1, M3-16): Reg.Chef photos uploaded as PHOTO sources become `visual_assets` (LIBRARY_PHOTO) with tags and a description; the visual director may choose them if rights allow visual transformation [S§6.2].
- **AI flag**: `visual_assets.is_ai_generated = true` for generated images; the review UI shows it. Disclosure policy (caption note, slide badge or platform label) depends on the legal review (Track B B-13, ⚠ V-16, task M5-12).
- **Embedding into HTML**: images are passed as data URLs → the render does not depend on network access.

## 8.5 Preview
- **Live HTML preview** (while editing): the edit drawer shows an iframe loaded from `/api/preview/slide?variantId=…&slideId=…` with the unsaved slot values posted as a draft. It uses the same `renderSlideHtml`, fonts and fit-text script as the renderer → what you see is what will be exported. Scaled with CSS transform.
- **Authoritative preview**: the rendered JPEGs (presigned URLs), in a carousel viewer with a 4:5 phone frame, swipe, thumbnails, 1:1 zoom and QA badges.
- **Stale render**: if the content hash differs from the current render's input hash, the viewer shows "Re-rendering…" and approval is disabled until the new render is READY.

## 8.6 Render QA checks [S§18 "Rendering"]

| Check | How | Result on failure |
|---|---|---|
| Glyph coverage | `fontkit` `hasGlyphForCodePoint` for every character of every slot, per font used | `MISSING_GLYPH` (blocking, render not started) |
| Text overflow | after fit-text: `scrollHeight > clientHeight + 1` or `scrollWidth > clientWidth + 1` per `[data-slot]` | `TEXT_OVERFLOW` (blocking) with slide + slot |
| Required image present | template contract + `img.complete && naturalWidth > 0` | `VISUAL_MISSING` / `RENDER_FAILED` |
| Logo placement | DOM bounding box of `[data-logo]` equals template spec ± 2 px | `RENDER_FAILED` |
| Dimensions | every JPEG exactly 1080 × 1350 | `RENDER_FAILED` |
| File size | ≤ 8 MB ⚠ V-05 (target < 1.5 MB); re-encode at q85 once if larger | `RENDER_FAILED` |
| Slide count | 2–10 ⚠ V-05 (policy 5–10) | validator blocks earlier |
| Contrast (P1) | sample background pixels under each text box; WCAG ratio ≥ 4.5 | warning in QA report |

**Fit-text** (in-page script `fit-text.client.js`): for each `[data-fit]` element, start at `maxPx`, reduce by 2 px while it overflows and size > `minPx`; if it still overflows at `minPx`, set `data-overflow="true"`. Deterministic because fonts and viewport are fixed.

## 8.7 Export specification
- JPEG, sRGB, quality 90, chroma subsampling 4:4:4 (crisp text), 1080 × 1350 px (4:5 portrait — the tallest ratio the publishing API accepts ⚠ V-05).
- All slides of a carousel have the same size (Instagram crops carousel items to the first item's ratio ⚠ V-05).
- 2–10 slides per carousel (API limit ⚠ V-05).
- 3:4 (1080 × 1440) is a post-MVP experiment only if the API accepts it (P2-09).

## 8.8 Storage layout (R2, private bucket per environment)

| Prefix | Content |
|---|---|
| `sources/{sourceAssetId}/{file}` | uploaded source files |
| `assets/{variantId}/{slideId}-{slot}-{promptHash}.webp` (+ `.orig.png`) | generated images |
| `library/{visualAssetId}.webp` | library photos (P1) |
| `renders/{variantId}/{renderId}/{index}.jpg` | final slides (Meta fetches these through presigned URLs) |
| `imports/{uuid}.{csv,json}` | import files |
| `tmp/` | temporary files (cleanup P2) |

## 8.9 Visual regression tests
- Fixtures per template: ES long text, EN short text, max-length slots, special characters (`ñ ¿ ¡ á é í ó ú ü`, `°`, `½`), one missing optional slot.
- Golden PNGs in `templates/__golden__/`. Compare with `pixelmatch` (threshold 0.1, fail if > 0.1 % of pixels differ).
- CI job runs when `templates/**` changes and nightly, with a pinned Playwright/Chromium version and bundled fonts.
- `pnpm test:visual --update` regenerates goldens; changed goldens must be reviewed in the PR.
- Chromium in Claude Code cloud sessions: use the pre-installed browsers (`PLAYWRIGHT_BROWSERS_PATH`) — never download browsers in the session.

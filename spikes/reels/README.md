# Reels spike (2026-10-13)

Scripts from the test that produced the accepted Reel format (`docs/design/reel-style.md`, plan `docs/plan/18-reels.md`). They are reference code for M8-02 (video provider), M8-05 (assembly) and M8-08 (audio), not a product feature. Inputs and outputs (photos, clips, finished Reels) are not committed.

| File | What it does |
|---|---|
| `hf-i2v.sh` | One image-to-video shot through the Higgsfield API: upload the picture, submit, poll, download. Reads `HIGGSFIELD_API_KEY` (`<id>:<secret>`) from the repo `.env`; never prints it. |
| `render-cards.mjs` | Text cards as transparent 1080×1920 PNGs through Chrome and Playwright (Inter Tight, safe zone). Input: a JSON list like `cards.example.json`. Run it from this folder. |
| `build-reel-v3.sh` | Cuts the shot clips, overlays the cards, concatenates on the 120 BPM grid and muxes the beat. Variant `A` (pour hook) or `B` (0.88 s flash opener). Expects `hook2-wan.mp4`, `scenes/s2…s8`, `cards/c1…c8.png` in the folder you pass. |
| `make-sound.py` | A royalty-free placeholder beat (kick, clap, hat, bass, cut accents, an impact on scene 5) as WAV; pure Python. |

## Usage sketch
```bash
# one shot (spends money: about $0.1–0.5 with alibaba/wan-3.0, 3 s, 720p)
spikes/reels/hf-i2v.sh photo-9x16.jpg out.mp4 "Static camera. <one concrete motion>. No text, no people." alibaba/wan-3.0 3 720p

# cards (from this folder), then the Reel
cd spikes/reels && node render-cards.mjs cards.example.json ./cards
./build-reel-v3.sh <dir with scenes and cards> B reel.mp4
```

## Findings worth keeping
- Models: `alibaba/wan-3.0` (cheapest, chosen), `kling-video/v3.0/std`, `bytedance/seedance-2.0`; endpoint `POST https://api.higgsfield.ai/<model>/image-to-video`, status `GET /requests/{id}/status`, uploads `POST /files/generate-upload-url`.
- "Camera push-in" prompts make Wan morph the scene; use "static camera" plus one motion.
- Wan outputs a grey cast; `colorlevels=rimax=0.9:gimax=0.9:bimax=0.9` brings the background back to white.
- Jobs can sit in the queue for 10+ minutes; a retry worked.
- `render-cards.mjs` imports `playwright-core` from the pnpm store (`node_modules/.pnpm/playwright-core@1.63.0`); adjust the path when the version changes.

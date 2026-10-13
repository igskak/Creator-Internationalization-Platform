# Reel style (accepted 2026-10-13)

Reference: the English bulgur test Reel, hook variant B. Plan and tasks: `docs/plan/18-reels.md`. This file is the spec the Reel director prompt and the renderer follow.

## Format
- 1080×1920, 30 fps, H.264 (High, yuv420p) + AAC, faststart, 12–20 s (never above 30 s).
- 6–9 scenes on a **120 BPM grid**: a scene is 3 to 5 beats (1.5–2.5 s), so every cut lands on a beat. Hard cuts only, no crossfades.
- Optional **flash opener** (variant B): four 0.22 s shots in the first 0.9 s under the hook card.
- Silent-first: the picture and the text card must work without sound. The first release adds a placeholder synthesized beat (kick and clap enter on scene 2, an impact on the "appetite" scene, a click on every cut).

## Story (one idea per Reel)
1. **Hook (0–2.5 s)**: a doubt about a familiar action, with motion in the first frame ("HOT WATER ON BULGUR?").
2. **Rule (next 1.5 s)**: the answer that opens a loop ("ONLY IF IT'S FINE.").
3. **Body**: one step per scene, a different frame each time.
4. **Appetite peak**: the most sensory shot (toast, sizzle, pour) with its card ("NUTTY. TOASTY. LIKE BREAD.").
5. **Payoff and ask**: the finished dish and one ask ("CHECK THE GRIND FIRST. SAVE IT."). The last card echoes a word from the hook.
- One emotion per scene: doubt, intrigue, "aha", appetite, usefulness, save.
- Every claim comes from the post's slides. No new facts, numbers or results.

## Text cards
- Inter Tight 800, uppercase, 92–128 px, line height 1.0, letter spacing −0.02 em; the ink colour of the carousel (`#111`), one accent word or line in the carousel red (`#E1251B`) per card.
- At most 6 words per card, 2–3 lines, left aligned at x = 70, top at y = 240.
- **Safe zone** on 1080×1920: nothing above y = 230 or below y = 1440; keep the right 230 px clear (Instagram's buttons and caption sit there). A card appears with a 0.12 s fade at the start of its scene.

## Picture
- Shots come from our own pictures (image-to-video), padded to 9:16 on pure white. Grey casts from the model are lifted to white with `colorlevels` (max 0.9).
- Layout per shot: a 907×1613 box placed flush right (the picture bleeds off the right edge, as in the carousel style), or full-bleed when the picture bleeds on both sides. The top 300–550 px stay white for the text card.
- Prompt rule for shots: "static camera" plus one concrete motion (pouring, stirring, tossing, a lid closing); no camera push-ins (the model morphs the scene), no text, no people.
- Same photographic rules as `docs/design/carousel-style.md` (high-key light, macro, no rustic surfaces).

## Cost and reuse
- A shot is 3 s at 720p. The estimate shown before a run = shots × seconds × the provider's rate. Shots are reused by prompt hash; the Spanish Reel reuses the English shots and only renders its own text cards.

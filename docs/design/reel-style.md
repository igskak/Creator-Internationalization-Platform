# Reel style (v4, accepted 2026-10-19)

Reference: the rice Reel "Giving every pot a stir?", variant A (white page, dark text), made by hand on 2026-10-19 (`spikes/higgsfield-test/stir-v4`, git-ignored). Plan and tasks: `docs/plan/18-reels.md`; why it changed: decision log, 2026-10-19 "Reels v4". This file is the spec the Reel director prompt (reel-director@4) and the renderer (1.3.0) follow. A script of reel-director@3 or older is still made the old way; see "Before v4" at the end.

## Format
- 1080×1920, 30 fps, H.264 (High, yuv420p) + AAC, faststart, 16–24 s (never above 30 s).
- 5–7 scenes on a **120 BPM grid**: a scene is 6 to 7 beats (3–3.5 s), long enough to read the card and its line. Hard cuts only, no crossfades. Fewer, calmer shots: the v3 Reels changed the picture every 1.5–2.5 s and lost viewers in about 2 s.
- **Calm hook**: the hook scene is held 3.5 s (7 beats) and its card is on screen from the first frame, no fade. No flash opener.
- **Sound**: the video model's own sound of each shot (`MODEL_AUDIO`): shot prompts name it ("Sound of the spoon scraping and water swishing."). Each cut gets short fades (30 / 50 ms), a clip without sound becomes silence, the whole track is brought to −14 LUFS. The picture and the text must still work without sound.

## Story (one idea per Reel, with a logic)
1. **Hook**: a problem the viewer recognises from their own kitchen, named concretely ("RICE NOT FLUFFY? **STOP STIRRING.**"), or a doubt about something they do, and the picture shows it (the cloudy, stirred pot). Never a vague "something wrong with your rice?". No line under the hook card: the question stands alone. Hook patterns and banned patterns: `docs/design/hook-library.md`. The hook shot names a strong motion (`REEL_HOOK_MOTION`, from reel-director@3).
2. **Rule (why)**: the cause or the rule; its line says why ("EVERY STIR RUBS OFF **STARCH.**" / "And starch is what changes the texture.").
3. **Steps**: one action per scene, in the order the viewer does them.
4. **Peak or flip side**: the most sensory moment, or the other side of the rule ("CREAMY? **NOW STIR.**").
5. **Summary**: the last card closes the loop with a word of the hook card; its line states the whole rule in one sentence and ends with the one ask ("Fluffy: hands off. Creamy: stir. Save this for your next pot."). A viewer who stops on the last frame has the full rule.
- One emotion per scene: doubt, intrigue, "aha", appetite or surprise, usefulness, save.
- Scene roles in order: `HOOK`, `RULE`, `STEP` scenes, exactly one `PEAK`, then the ending (`PAYOFF` with the ask, or `CTA`). Scene 1's card is the chosen hook's card and scene 2's its rule card, word for word, so "change hook" swaps two cards (the lines stay).
- Every claim, in a card or a line, comes from the post's slides. No new facts, numbers or results.

## Text
- **Card**: Inter Tight 800, uppercase, 92–128 px, line height 1.0, letter spacing −0.02 em; the carousel's ink (`#111`), one accent word or line in the carousel red (`#E1251B`). At most 6 words, 36 characters, 14 per word; left aligned at x = 70, top at y = 240, in a 780 px column; a white halo.
- **Line of use** under the card: one short sentence (at most 14 words, 80 characters), Inter Tight 400, 44 px (down to 36 px for a long one), line height 1.18, the same ink, column and halo, 30 px under the card; no accent, no emoji. It adds the reason, the condition or the exact action the card leaves out.
- **Safe zone** on 1080×1920: nothing above y = 230 or below y = 1440; keep the right 230 px clear (Instagram's buttons and caption). The card and its line appear with a 0.12 s fade, except on the hook.

## Picture
- **Every shot starts from a picture made for it.** The director writes `framePrompt` (English: the food, its cookware, its state, at the moment before the shot's motion); the system adds the account's look and the image model (gpt-image, 1024×1536) draws it; the frame is cut to 9:16 to fill (`cover`). The look: a pure white seamless page, soft high-key light, macro detail, the subject in the lower 60 % and the top 40 % white for the text, no people, hands, text or props (`REEL_FRAME_STYLE` in `modules/src/reels/generate/frames.ts`).
- **Pale or white food goes into dark cookware** (owner's rule, 2026-10-19): rice, pasta, risotto, cream, milk, potatoes, cauliflower, raw or boiled chicken, white fish, tofu, dough, oats… sit in black cast iron, dark enamel, charcoal ceramic or dark stoneware, so they stand out on the white page. Colourful or browned food may sit in white cookware. The director is told so, the look repeats it, and `REEL_PALE_ON_WHITE` refuses a frame prompt that puts pale food in white cookware.
- The hook shows the problem, a step its action, the summary the result (side by side when the rule has two sides). The same pot may come back, so the Reel feels like one kitchen.
- Layout `FULL`: the picture fills the frame. Grey casts from the video model are lifted to white from the measured page level.
- Shot prompts: "Static camera." plus one concrete motion of the food, a tool or the liquid, plus its sound; no camera movement (the model morphs the scene), no text, no people or hands.
- A picture the image model refuses: the shot starts from the carousel picture the director named (`sourcePictureId`), padded on white.

## Cost and reuse
- A shot is 4 s at 720p with sound; the first 0.2 s (still the start frame) are cut. The estimate shown before a run = shots × 4 s × the model's rate + one picture per shot ($0.05) + the director: about $2.80 on Wan, $2.97 on Kling, list prices.
- Pictures are `visual_assets` rows (slot `reel-frame`) found again by the brand and the hash of their prompt; shots are found by the hash of model, length, prompt, start frame and sound. A rerun, a changed hook or a redone shot pays only for what is new. The Spanish Reel that reuses the English pictures and shots (M8-06a) is not built yet; reel-director@4 asks for empty frame prompts on a base script.

## Before v4 (reel-director@1–3, renderer up to 1.2.0)
- 6–9 scenes of 3 to 5 beats (1.5–2.5 s), 12–20 s; the hook held 2.5 s; a placeholder synthesized beat as the audio.
- Shots from the carousel's own pictures padded to 9:16 on white; layout `RIGHT` (a 907×1613 box flush right, the top 300–550 px white for the card) or `FULL`; 3 s shots without sound.
- One card per scene, no line. Such scripts are still rendered this way (a change of hook or a redone shot of an older Reel).

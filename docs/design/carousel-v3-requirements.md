# Carousel v3: requirements for pictures and posts

**Status: IMPLEMENTED on branch `feat/carousel-v3` (PR #117, 2026-10-17): CV-01…CV-04 and the white cover switch; waiting for the owner's review and decisions D1–D4.** Builds on [carousel-style.md](carousel-style.md) (white page, Inter Tight, cut-out photos), which stays valid where this document does not change it.

## Why

The owner compared the English account with the Russian-language reference account (the internal reference of `carousel-style.md`; it is never named in anything audience-facing) and found the reference carousels much livelier and more attractive. This document records what was compared, what makes the difference, and the requirements for the next versions of the visual director, the writer, the slide plan and the templates.

## What was compared

| | English account (ours) | Reference account |
|---|---|---|
| Carousels looked at | 4 (wet rice rescue, 7 slides; buckwheat fat, 6; rice formula, 7; the profile grid) | 4 (rice, 8 slides; fried rice, 8; fried egg, 8; cauliflower, 8; the profile grid) |
| Format | 1080 × 1350 (4:5) | 1254 × 1254 (1:1) |
| How a slide is made | HTML template with the text + a separately generated photo placed behind it | **one generated image per slide, text included** (the alt text of every slide is its image prompt) |
| Caption | about 700 characters | about 2,300 characters |
| Comments per post | 0 | 179–637, mostly the CTA keyword |

The audiences differ by orders of magnitude, so the engagement numbers only show that the keyword CTA works there; the visual and structural differences below are what we can copy in kind.

### How the reference slides are produced

Each slide prompt has the same skeleton: square, pure white `#FFFFFF`, "premium keynote-style minimalism", about 120 px safe margins, soft diffused studio light; **on the right** a realistic macro food shot with a concrete subject and action; **on the left** the exact slide text in a grotesque (bold headline, regular body), with the phrases to set in bold named; the handle small at the bottom. Because the image model lays out the photo and the text together, it sizes the food to the free half: objects are whole, nothing sits under the text, and the white of the photo is the white of the page.

## Findings

| # | Ours | Reference |
|---|---|---|
| F1 | **The photo is a fragment.** The prompt already puts the subject in the right and lower part of the frame, then the template shifts the picture again by a fixed offset (B +280/+240 px, D +200/+280, E +330/+400, F +180/+320, plus the `place-*` classes). Half a pot sticks out of the corner. | The hero object (bowl, plate, pan, spoon) is whole inside the right half; at most a small part is cut by the right edge. |
| F2 | **The same object on every slide.** Wet rice: 6 of 7 pictures are white rice in a black pot. | The same food all the way through, but **a different state or step on each slide**: white rice → rice mixed with yolk → golden fried rice; egg white alone → yolk sliding onto it → yolk cut open. |
| F3 | **Dark, heavy vessels.** The v5 rule "pale food needs a dark vessel" made black and green cast iron our signature; the grid is dark pots and oil pours. | White porcelain, brushed steel, clear glass. Colour comes from the food around the main one (yolk, carrot, peas, herbs, toast, lemon) and from soft shadows. |
| F4 | **The picture does not match the step.** "Spread them on a wide warm skillet" shows a deep pot. | The picture shows exactly the moment of the slide. |
| F5 | **One subject per frame.** | Frames of 2–6 elements with a meaning: three bowls stacked = three stages; the portion laid out in small glass bowls; two plates = wrong and right; a hero in front with a related dish soft-focused behind (depth); a tool doing the step (spoon lifting, scissors cutting, wok tossing, tweezers holding) without a hand. |
| F6 | **Thin text.** 100–220 characters, generic lines ("breathe, there's a calm fix"), no numbers. | 250–600 characters: amounts, times, heat, the order of actions, a "why", how to tell it worked. One sentence per line (a "ladder"), bold sub-heads ("For seasoning:", "Important:"), a bold last line that sets up the next slide. |
| F7 | **Arc:** hook → situation → fix 1 → why → fix 2 → summary → save. | **Arc of 8:** hook (doubt about a habit + what the post promises) → how we usually do it → the principle → the portion with amounts → 2–3 steps with numbers → how to tell it worked → the signature closing line + CTA. |
| F8 | Headline always 800 uppercase with a red word. | Often two weights: a regular lead-in and a bold punch line ("THE PERFECT FRIED EGG IS BETTER COOKED / **NOT ALL AT ONCE.**"). Colour is rare. |
| F9 | — | Occasional thin-line callouts on the photo ("WHITE → first", "YOLK → later"). |
| F10 | Covers are dark full-bleed photos; Reel covers without text sit between them. | The cover uses the same white system as the inner slides (headline left, photo right); the grid reads as one series of pages. |
| F11 | Caption: a few generic paragraphs, emoji numbering, "save this". | Caption repeats the whole method with the numbers, adds an "Important:" limit (which varieties it does not cover), one personal line, the signature line, a lead-magnet CTA in steps (follow + comment a keyword → a bot sends the link), a light joke about following, 5 hashtags. |
| F12 | **Layout bugs:** body text under the photo (buckwheat slide 5, bottom band); a headline broken inside a word ("BUCKWHE / AT NIGHT", slide 6). | — |
| F13 | **Thin knowledge.** The approved cards behind our posts are a single claim each: of 81 cards (22 approved) only 20 have steps, 13 ingredients, 5 timings and 1 a temperature; all of them come from one 18-page guide and two posts. The closed-book writer cannot add an amount the cards lack, so the slides stay general however good the prompt is. | The posts are written from deep knowledge: amounts (240 ml, 330 ml), times (13 min, 10 min), the order of steps, the limits of the method. |

### What the new prompts make from deep knowledge

On 2026-10-17 the planner, writer, critic and visual director of v3 ran live on one private case made from the owner's own rice method (two cards with steps, amounts and times; the case stays outside git): a 9-slide English carousel with the reference's arc (hook, the usual mistakes, why it works, the ratio, three steps with their numbers, a checklist with an "Important:" limit, the closing line), ladder bodies of 150–330 characters, leads and closers, and a 1,288-character caption with the whole method; pictures in white porcelain, steel, clear glass and a copper measuring cup, three spoons of rice in states, a strainer over a glass bowl. Text $0.94, pictures $0.38. On a card that holds one bare claim the closed book leaves the writer nothing to add (not run live yet): **the knowledge depth (K1) decides as much as the prompts.**

## Decision D2: how a slide is produced

| Option | How | For | Against |
|---|---|---|---|
| **A. Measured placement** (recommended now) | Keep the HTML text and the separate photo; after generation measure the subject's box on the white and fit it into the slide's photo zone. | Deterministic, text editable and checked (slot limits, claims, glyphs), any language, cheap. Fixes F1 and F12. | The model still composes the photo without seeing the text. |
| **B. Whole slide by the image model** (as the reference) | One image per slide with the text in the prompt. | The most natural integration. | Typos and wrong accents (Spanish), no text edit without a new image, claims and slot checks lose their meaning, look drifts between slides, cost per slide edit. |
| **C. Hybrid edit** (spike) | Render the final text slide first, then let the image model paint the food into the empty zone with a mask (`/v1/images/edits`, ⚠ verify mask support of the current gpt-image model). | The model sees the text and composes around it; the text stays exact. | New provider call, a bit more cost, needs a spike. |

Recommendation: A in the templates now, C as a one-carousel spike compared side by side with A; B is rejected for production because of text control.

## Requirements: pictures

Owner of the change: `visual-director@7`, `modules/src/content/visual/photo-prompt.ts`, `@rc/templates`.

- **P1 · Whole subject.** The main object is fully visible. At most about 15 % of its box may be cut, by the right or the bottom edge only; the top edge only for a tool entering from above (spoon, wok, whisk). Never a "corner of a pot".
- **P2 · Placement by the measured box.** After generation the code finds the subject's box (pixels darker than the white threshold, ignoring the soft shadow) and scales and moves the picture so the box sits in the slide's photo zone: the right 50 % of the width, from the top of the headline to above the footer, with a 24 px gap to the text column. The fixed `translate(...)` offsets of templates B, D, E, F and the `place-*` classes go; a placement now chooses the zone (right half, top right, right column, bottom band), not an offset. The box is stored with the asset so a re-render is the same.
- **P3 · One picture = the slide's moment.** The director gets the slide text and names in a new field `depicts` the words of the slide the picture shows (the tool, the state, the action). A tool or ingredient in the picture must be named by the slide or `<recipe>` (already a rule; now checked against `depicts`).
- **P4 · Same food, changing state.** A carousel may keep one food throughout, but no two pictures show the same food in the same state in the same vessel. Checked in code on `depicts` + `arrangement` + vessel.
- **P5 · Frames with a meaning.** New arrangements next to v6's: `STAGES_STACK` (two or three bowls of the same size one above another, in order), `MISE_EN_PLACE` (the portion: the main ingredient plus 3–6 small white or glass bowls with the measured ingredients), `PAIR` (two plates or states side by side, wrong and right), `HERO_WITH_DEPTH` (the hero in front, a related vessel or dish soft-focused behind it), `TOOL_IN_ACTION` (a spoon, spatula, knife, scissors, tweezers or wok doing the step, no hand). An 8-slide carousel uses at least four arrangements; the PORTION slide is always `MISE_EN_PLACE`.
- **P6 · Light vessels, colour from food.** Default vessels: white porcelain bowls and plates, brushed steel pans and pots, clear glass bowls. Black cast iron or dark ceramic at most once per carousel and only when the recipe uses it. Every picture has at least one coloured food element (yolk, carrot, peas, herbs, lemon, golden crust, toast, sauce), except at most two deliberately plain ones. This replaces v5's "pale food needs a dark vessel": pale food gets a coloured companion, a white porcelain rim and a soft contact shadow.
- **P7 · Style sentence.** As now (pure white, high-key soft studio light, natural contact shadow, shallow depth of field, crisp texture), plus: realistic appetizing texture, glossy where the food is glossy, a soft-focus second element allowed behind the hero. Remove "props" from the fixed negative list in favour of "decorative props, packaging, branded items".
- **P8 · Callouts (later).** Up to two short labels with a thin line pointing at an element, drawn by the template, not by the image model. Needs the measured box (P2); not in the first version.
- **P9 · Cover (D1).** A white cover template (headline left, photo right, same system as the inner slides) next to today's dark full-bleed cover. Recommended for carousels so the grid reads as one series; the dark cover stays for Reels.

## Requirements: slide plan and slide text

Owner of the change: `market-adapter@4` (plan), the next `content-writer` (merged with G-04 so one eval pays for both), `@rc/templates` 3.0.

- **T1 · Arc of 8.** Default 8 slides (still 5–10): HOOK → USUAL_WAY (what people usually do, a ladder of short lines ending in the problem) → PRINCIPLE (one mechanism, why) → PORTION (ingredients with amounts for a named number of servings) → STEP × 2–3 (amount, time, heat and a visible cue) → CHECK (3–5 signs it worked) → CLOSING + CTA. USUAL_WAY, PORTION and CHECK are new roles (or mapped onto PROBLEM, FACT and SUMMARY if the catalog stays). A post without a recipe (a myth, a principle) drops PORTION and keeps the rest. Sibling markets still take a visibly different route.
- **T2 · Concrete, not generic.** Every STEP slide carries at least one number from the cards (amount, time, temperature) and one visible cue ("until the water turns clearer"). Banned filler, checked in code: "breathe", "no rush", "calm fix", "it happens to everyone", "here's the thing", "the secret is simple". A STEP without a number goes to repair once.
- **T3 · Ladder body.** The writer writes the body as short lines, one sentence or fact per line, with blank lines between groups; bold sub-heads end with a colon ("For 2 servings:", "Important:"). The template sets each line on its own row.
- **T4 · Capacity.** Body up to 420 characters / 14 lines at 28–30 px in a 500 px column (templates B, D, E, F); headline 2–3 lines. Slot limits and fit-text follow.
- **T5 · Two-weight headline.** An optional `lead` slot (regular weight, uppercase, smaller) above the bold `headline`. The accent colour only for a figure or one word, not on every slide.
- **T6 · Punch line.** An optional bold `closer` slot at the bottom of the body: a consequence or a question the next slide answers ("So how do you get both at once?").
- **T7 · Signature closing (D3).** Each market gets its own recurring sign-off line, set by the owner in the brand voice; never a translation of the reference's line.
- **T8 · Hook.** A doubt about a habit or a surprising claim, plus 1–3 short lines that list what the post delivers (for example the four conditions). Hook-library rules still apply.

## Requirements: caption and CTA

- **C1 · The caption carries the method.** 1,200–2,200 characters: the hook line, the problem in one or two sentences, the method in short paragraphs with the numbers of the slides, "Important:" with the limits (which varieties or sizes it does not cover), one personal line that states no fact, the signature line, the CTA. Plain numbering ("1.", "2."), not emoji digits.
- **C2 · Keyword CTA (D4).** Where a market has an offer (a free lead magnet first, for example a one-page grain ratio sheet), the CTA is "follow + comment WORD and get it", in numbered steps. Needs the offer in the database and a DM path (P2-04 or a manual reply from G-07). Until then G-04's rotation of save, send and follow applies.

## Requirements: knowledge

- **K1 · Ingest the owner's methods.** The owner's guides and the methods of the Russian posts go into the source library (GUIDE or NOTE, Markdown or PDF): each method with its amounts, times, temperatures, order of steps, usual mistakes and limits. The extractor already keeps procedure, ingredients, timings, temperatures and mistakes as fields; the cards then reach the writer as data it may use. Ideas are generated from those cards.
- **K2 · An idea needs enough knowledge.** The idea generator prefers ideas whose cards hold steps and numbers; an idea resting on one bare claim becomes a short tip post or a Reel, not an 8-slide carousel.

## Requirements: Reels

The reference account's Reels are a different genre (memes about restaurant life and the chef's own footage, with a white speech-bubble caption), so they are not copied. What carries over from the carousel study:

- **R1 · Pictures.** Reels are cut from the carousel's pictures, so CV-01/CV-02 (whole subjects, light vessels, colour from food) improve them directly.
- **R2 · White stays white.** The image-to-video model leaves a grey cast (the accepted bulgur Reel shows a light grey page); the lift is set per shot from the measured page colour, as the slide placement script does, instead of the fixed 0.9 level.
- **R3 · A designed cover.** The Reel's grid cover is a slide in the carousel's white system with the hook headline (`cover_url` on the REELS container, ⚠ verify), not the first frame, so the grid reads as one series.

## Requirements: checks before review

- **Q1 · No text over the photo.** The measured subject box and the rendered text boxes (from the slide DOM) do not intersect; a 24 px gap. Blocking.
- **Q2 · No word broken inside.** Display slots never wrap inside a word: fit-text shrinks until the longest word fits, `overflow-wrap:break-word` is removed from display slots, and a word that still does not fit at the minimum size fails the render.
- **Q3 · Subject visible.** At least 85 % of the subject box is inside the slide.
- **Q4 · No near-duplicates.** Neighbouring pictures with almost the same colour histogram and layout are flagged.

## Owner decisions

| | Question | Recommendation |
|---|---|---|
| D1 | White cover for carousels instead of the dark full-bleed one? | Yes for carousels, dark stays for Reels. |
| D2 | How a slide is produced (A, B or C)? | A now, C as a spike. |
| D3 | The recurring sign-off line per market. | The owner writes it. |
| D4 | A lead magnet and keyword CTA for the English account? | Yes, one free sheet first. |

## Plan

Tasks are in `docs/plan/15-task-list.md`, section **CV · Carousel v3**. Order: CV-01 (templates, fixes the visible bugs without any prompt change) → CV-02 (pictures) and CV-03 (templates 3.0) → CV-04 (plan and writer) → CV-05 spike → CV-06 after D4 → CV-07 knowledge (K1, K2) → CV-08 Reels (R2, R3). Every prompt change is a new version with a live eval and a decision-log entry.

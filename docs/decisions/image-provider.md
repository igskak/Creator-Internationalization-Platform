# Image provider · bake-off [M3-15]

**Status: REVIEW OPEN.** The images are made and the blind review page is published; the verdict waits for the ratings of Ihor and Sergey. Fill in the result below, then set the default model. Owners: Ihor and Sergey.

## Candidates

Both from OpenAI, through the app's own adapter (`lib/src/providers/image/openai.ts`), quality `high`, portrait `1024x1536`:

- `gpt-image-2.5-flare`: the current default (M3-03), "fast, high-quality everyday generation".
- `gpt-image-2.5-sunburst`: "editing precision".

Another vendor (Google, Black Forest Labs) was considered and left out by the owner for this round: it needs a new key and a second adapter, while the two OpenAI models run on what exists. If neither model is good enough for "premium macro food", a second round with another vendor is the next step.

## Method

1. **Briefs.** The visual director (`visual-director@2`) planned the pictures of the 8 READY_FOR_REVIEW variants in the dev database (4 ideas × es-ES and EN): 8 real briefs, 5–9 slots to generate each. Fewer than the 10 the task names: the database had 8 variants, and the owner chose not to generate more for this.
2. **Images.** For each brief the first GENERATE slot (the main picture), once per model, with the brief's prompt and negative prompt (`spikes/image-bakeoff/images.ts`). 16 images, no failure, no moderation block.
3. **Blind review.** A private page shows each brief's two pictures as A and B in a random order per brief; JPEG copies without the PNG metadata (the originals carry OpenAI's C2PA data, which names the model). Each reviewer scores both pictures 1–5 on four points (appetite and premium look, realism without AI artefacts, fidelity to the brief, light and macro) and picks A, B or a tie, with an optional note. Each reviewer's ratings are private to them; the owner's account reads all of them. The A/B key stays in the git-ignored `spikes/image-bakeoff/out/results.json` until the ratings are in.

The pictures and the prompts come from real content and stay out of git (`spikes/**/out`).

## Measured

| | flare | sunburst |
|---|---|---|
| Images | 8 of 8 | 8 of 8 |
| Latency (median, min–max) | 17 s (15–19) | 30 s (26–40) |
| Tokens per image | 1,372 image output, about 150 text input | the same |
| Cost per image | **$0.042** | **$0.042** |

Prices (OpenAI pricing page, read 2026-10-11): the same for both, USD 5 per million text input tokens, 8 per million image input tokens, 30 per million image output tokens. The adapter's per-image estimate for `high` was 0.19 USD (the gpt-image-1 figure), about 4.5 times too high; it now prices each image from the `usage` of the answer and keeps the table only as a fallback.

A carousel with 6–8 generated pictures costs about **$0.25–0.35** in images with either model; the price does not decide. Latency matters for a regeneration a person waits for; for the background job (J7, three slots at a time) both are fine.

## Result

To be filled in from the review page.

| | flare | sunburst |
|---|---|---|
| Briefs won (Ihor) | | |
| Briefs won (Sergey) | | |
| Ties | | |
| Mean score: appetite / realism / brief / light | | |

Decision: _open_. Proposed rule, to confirm with the owner before the ratings are read: sunburst replaces flare only if it wins clearly on the reviewers' picks (more briefs won by both reviewers); on a tie flare stays, as it is twice as fast at the same price.

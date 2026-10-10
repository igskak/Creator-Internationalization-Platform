# Image provider · bake-off [M3-15]

**Status: DECIDED (2026-10-11).** Default model: **`gpt-image-2.5-sunburst`** (was `gpt-image-2.5-flare`). Decided by the owner on the owner's own blind ratings; Sergey had not rated when the decision was taken. Owners: Ihor and Sergey.

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

Rule confirmed by the owner before the ratings were unblinded: sunburst replaces flare only if it wins more briefs on the reviewers' picks; on a tie flare stays, as it is twice as fast at the same price.

Ratings of Ihor (all 8 briefs, unblinded 2026-10-11):

| | flare | sunburst |
|---|---|---|
| Briefs won | 1 | 2 |
| Ties | 5 | 5 |
| Mean score: appetite / realism / brief / light | 3.50 / 4.50 / 5.00 / 4.50 | 3.62 / 4.50 / 4.88 / 4.50 |
| Mean of all scores | 4.38 | 4.38 |

The two models are close: equal mean scores and 5 ties in 8. Sunburst won two briefs (one rated "a bit more realistic"); its one loss was a brief where its picture was rated a mess ("каша"). Appetite is the weakest point of both (3.5–3.6).

Decision: the owner applied the rule to the owner's ratings alone and chose **sunburst** (2 wins against 1). `OPENAI_IMAGE_MODEL` is now `gpt-image-2.5-sunburst`; no second adapter is needed. The cost is unchanged; a picture takes about 30 s instead of 17 s, which matters only for a regeneration a person waits for.

Limits of this result: one reviewer, 8 briefs, one picture per brief, a one-brief margin. Sergey's ratings, when they come, can be added to the table; if they clearly favour flare, revisit. The weak appetite scores are a prompt question as much as a model one: look at the visual director's prompts when the first real carousels are reviewed.

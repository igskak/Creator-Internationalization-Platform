# Hook library: patterns for carousels and Reels

Status: draft · Date: 2026-10-14 · Used by: `market-adapter`, `content-writer` (carousel cover and caption first line), `reel-director` (M8-03), analytics by `hook_type` (plan 11, M8-10).

Source: Illya Kosenko, "100 заголовків для Reels і TikTok" (illyakosenko.online/100hooks; the owner's copy is `~/Downloads/100_hooks_reels_tiktok_illya_kosenko.docx`, not in git because it is third-party material). The list has two numbered parts: 32 hooks with examples (below **E1–E32**) and 68 without them (**R1–R68**). Its reach figures are the author's own and are not used as thresholds. We take the **patterns**, not the wording: every example below is ours, and the prompts write new lines for each post.

## 1. One taxonomy for both formats

Hooks already have a taxonomy: `hook_type` in `db/src/seed/taxonomy.ts` (10 codes, plan 04 §4.7). `market-adapter` picks one per market, `content-writer` writes the hook line and the HOOK slide for it, the reviewer's reason code `WEAK_HOOK` marks a bad one, and plan 11 measures save and share lift by `hook_type`. Today the prompts get only the code and its label ("Mistake callout"), with no patterns or examples.

This library adds the missing part: **concrete patterns per `hook_type`**. Reels use the **same codes** (no separate Reel taxonomy), so one report compares carousels and Reels by hook type.

What differs by format is only the length and where the hook sits:

| | Carousel | Reel |
|---|---|---|
| Where | the cover (HOOK slide headline, up to 70 characters, 4 lines) and the first line of the caption (`hook`) | the first card (at most 6 words) and the rule card after it |
| Second beat | slide 2 answers the cover | `ruleCard` answers `card` |
| Room | a full sentence fits ("Lavas el arroz del risotto. Ese es el error.") | the core of the pattern only ("STILL RINSING **RISOTTO RICE?**") |
| Visual and audio hook | the cover photo (`carousel-style.md`) | motion in frame 1, the flash opener, the beat (`reel-style.md`) |

## 2. Patterns per `hook_type`

Examples are illustrative: in a real post the claim must come from the knowledge cards (carousel) or the carousel's slides (Reel). In Reel cards `**…**` marks the accent word.

| `hook_type` | Patterns (source) | Best with `angle` | Carousel cover EN / ES | Reel card EN / ES |
|---|---|---|---|---|
| `MISTAKE_CALLOUT` | the number one mistake in [topic] (E3, E23, E32, R3, R21, R39); still doing X? (E25, R10, R25); don't X until… (E31, R41); you do X wrong (R56); without X you won't get Y (E16) | COMMON_MISTAKE, TROUBLESHOOTING | Stop rinsing your risotto rice. / Lavas el arroz del risotto. Ese es el error. | STILL RINSING **RISOTTO RICE?** / ¿AÚN LAVAS EL ARROZ **DEL RISOTTO?** |
| `MYTH_BUST` | a popular belief → not always / wrong (E7, R9, R11, R24) | MYTH_VS_FACT | "Always rinse rice" is only half true. / "Lava siempre el arroz" es media verdad. | "ALWAYS RINSE RICE." **NOT ALWAYS.** / "LAVA SIEMPRE EL ARROZ." **NO SIEMPRE.** |
| `CONTRARIAN` | the worst common advice (E6, E12); a rule you'll disagree with (E29); do this instead of the popular X (R32, R67) | MYTH_VS_FACT, COMPARISON | The worst pasta advice: oil in the water. / El peor consejo para la pasta: aceite en el agua. | THE **WORST** PASTA ADVICE / EL **PEOR** CONSEJO PARA LA PASTA |
| `CURIOSITY_GAP` | did you know (E5); a way you didn't know (R16); the secret of [topic] that gives [result] (E14); what happens when you X (R8) | SCIENCE_EXPLAINER, INGREDIENT_SPOTLIGHT | Bulgur is already cooked. That changes how you make it. / El bulgur ya viene cocido. Y eso cambia cómo se prepara. | BULGUR IS **ALREADY COOKED.** / EL BULGUR YA ESTÁ **COCIDO.** |
| `RELATABLE_PROBLEM` | annoyed by X too? (E22, E27); why your X fails (R4, R13, R36, R49); your problem comes from this (R34, R44) | TROUBLESHOOTING, SCIENCE_EXPLAINER | Why your rice goes mushy. / Por qué tu arroz queda pastoso. | RICE STUCK TO THE **POT?** / ¿EL ARROZ SE **PEGA?** |
| `HOW_TO_PROMISE` | the easiest / laziest way to [result] (E4, E11, E17, E19); want X? do this (E8, E28, R19); X so that Y (E21); in one action (E24, R63); the only way to X without Y (R12, R42); a formula in 3 steps (R15) | TECHNIQUE_HOW_TO, QUICK_TIP | The laziest way to fluffy bulgur. / La forma más fácil de un bulgur suelto. | WANT **NUTTY** BULGUR? → TOAST IT **DRY.** / ¿BULGUR CON SABOR A **NUEZ?** |
| `NUMBER_OR_STAT` | N rules / tips / signs about [topic] (E10, E15, R27); top N beginner mistakes (R50); a number from the cards | CHECKLIST, COMMON_MISTAKE | 3 ways to ruin a risotto. / 3 formas de arruinar un risotto. | 3 WAYS TO RUIN **RISOTTO** / 3 FORMAS DE ARRUINAR UN **RISOTTO** |
| `DIRECT_QUESTION` | a doubt about a familiar action, asked as a question → the rule (the accepted bulgur Reel); "you know what annoys most in [topic]?" (E22) | COMMON_MISTAKE, QUICK_TIP | Hot water on bulgur? Only if it's fine. / ¿Agua hirviendo al bulgur? Solo si es fino. | HOT WATER ON **BULGUR?** → ONLY IF IT'S **FINE.** / ¿AGUA HIRVIENDO AL **BULGUR?** → SOLO SI ES **FINO.** |
| `BOLD_CLAIM` | the one thing you need for [result] (E9, R1); the main rule everyone ignores (R17); the biggest truth about [topic] (E26) | QUICK_TIP, TECHNIQUE_HOW_TO | The one ratio every pot of rice needs. / La única proporción que necesita tu arroz. | ONE RULE FOR **FLUFFY** RICE / UNA REGLA PARA UN ARROZ **SUELTO** |
| `BEFORE_AFTER` | the same thing, two results, one difference; "if I'd known earlier" without the "I" (R23) | COMPARISON | Same rice, two pots: only the water changed. / Mismo arroz, dos ollas: solo cambia el agua. | SAME RICE. **DIFFERENT** WATER. / MISMO ARROZ. **OTRA** AGUA. |

Format limits per type:
- `NUMBER_OR_STAT`: N is the real number of points on the slides (carousel) or of `STEP` scenes (Reel), from 3 to 5; a statistic only when a card states it.
- `BEFORE_AFTER`: carousel uses the `TWO_STATES` arrangement; a Reel needs two shots of the two states.
- `BOLD_CLAIM` is the riskiest type: the claim must be on a card word for word in meaning, otherwise use `CURIOSITY_GAP`.

## 3. Banned patterns (both formats)

| Pattern | Source | Why |
|---|---|---|
| Invented experience or effort: "I spent N years", "I tested 100+ ways", "I tested it for a month" | R14, R22, R53 | Fabricated claim; a brand account has no such biography |
| Invented certainty or statistics: "works 100% of the time", "guaranteed", "10× better", "works for everyone", "always works" | R29, R37, R45, R46, R57 | Numbers and results not from the cards (R-26) |
| Conspiracy framing: "experts are hiding this", "nobody talks about this", "forbidden trick", "everyone keeps quiet" | R5, R6, R26, R30 | Clickbait without a claim; use `CURIOSITY_GAP` or `CONTRARIAN` with a real claim |
| A time promise: "in 1 minute", "in 60 seconds", "by tomorrow", "this month", "in a week" | E2, E7, R31, R35, R54, R65 | Talking-head filler; usually a promise the post does not make |
| First-person secret or self-promotion: "my best hack", "my secret method", "what I'd do if I started over" | E1, R2, R33, R64 | Brand voice, not a creator's voice; the same idea works as `CURIOSITY_GAP` or `BOLD_CLAIM`. In code only "what I'd do if…" is blocked; "my trick" stays with the citation rule (a chef statement is allowed for a cited claim) |
| Empty hype with nothing after it: "this will change your approach", "the tool you can't do without", "everything you need, no fluff" | R40, R47, R58, R59, R60, R61, R68 | Slide 2 or the rule card has nothing to answer |

## 4. Save and share prompts go to the CTA, not the hook

The source's "save this", "screenshot this" and "show a friend" hooks (E20, E30, R7, R28, R43, R51) and "grab the checklist" (R20, R38) are calls to action. They map onto the existing `cta_type` codes and go on the CTA slide or the last Reel card:

| `cta_type` | Carousel CTA slide EN / ES | Reel last card EN / ES |
|---|---|---|
| `SAVE` | Save it for your next pot of rice. / Guárdalo para la próxima vez que hagas arroz. | CHECK THE GRIND. **SAVE IT.** / MIRA EL GROSOR. **GUÁRDALO.** |
| `SHARE` | Send this to whoever still rinses risotto rice. / Mándaselo a quien aún lava el arroz del risotto. | SEND TO WHOEVER **RINSES RICE.** / MÁNDASELO A QUIEN **LAVA EL ARROZ.** |

One ask per post. The Reel's last card echoes a word from its hook (`reel-style.md`).

## 5. Carousels: what changes (task M2-12b)

1. **Library in code.** `prompts/src/shared/hook-library.ts`: per `hook_type` code its patterns (one line each), best angles and two examples per market language; plus the banned list per language (`en`, `es`). Keyed by code; a code added later in `/settings/brand` without an entry falls back to its label.
2. **`market-adapter@3`.** Each `<hook_types>` term carries its patterns and best angles, so the choice is based on what the idea's angle supports, not on the label alone. The sibling rule stays (another market gets another hook type).
3. **`content-writer@5`.** For the plan's `hookType` the prompt gets its patterns and examples as guidance, plus the banned list as a rule. It writes a native line in the market's language, never a translated example.
4. **Check in code (one repair): `validateHookLine`** (`modules/src/content/validation/hook.ts`). Applies to the hook line and the HOOK slide. No phrase from the banned list of the market's language (`en`, `es`; none for other languages). A number without a unit must be a number stated by a card, `1`, or the count of the body slides (so "3 ways" passes with three body slides); numbers with units stay with numeric fidelity. Both are BLOCKERs, so they go through the existing repair, and an unresolved one raises `UNSUPPORTED_CLAIM`. Before this, a HOOK slide with `factual: false` cited nothing and an invented number there was not caught.
5. **Eval.** The content-writer eval set before and after: the judge's hook score, and over the following weeks the reviewers' `WEAK_HOOK` rate. Released prompt files are not edited; the change ships as new versions.

## 6. Reels (M8-03, after M2-12b): what changes

Done in M8-03 (`reel-director@1`, `modules/src/reels/director/`):

1. `ReelHookOption.formula` became **`hookType`**, a `hook_type` code of the shared taxonomy; the answer schema of the call accepts only the codes of the taxonomy given. It is a JSON column, so no migration.
2. The dialog's 3 options use **3 different hook types** (`REEL_HOOK_TYPES_DIFFER`). The prompt asks for option 1 in the source carousel's hook type when the slides support it, and not to offer the hook types of the market's latest Reels (`recentHookTypes`, newest first).
3. `ReelHookOption.claimSlideIds` was added, because the `ruleCard` is a claim (`REEL_HOOK_CLAIM_MISSING`).
4. The Spanish Reel keeps the English Reel's hook type and scene structure (shared shots, Q-10): the input takes an optional `baseScript`, the prompt keeps its scenes and writes only the cards, and `REEL_BASE_CHANGED` blocks any other change.
5. Reel cards come from `HOOK_REEL_CARDS` (first cards, at most 6 words), not from the carousel cover lines. `hookGuidance(code, language, "reel")` renders them.
6. Validators beyond 18 §18.4: hook types distinct and in the taxonomy; the chosen option's two cards on scenes 1 and 2 word for word; numbers with units match the cited slides (the numeric-fidelity check), a bare number is on a cited slide, is `1` or is the number of `STEP` scenes; the banned patterns of §3 on every card; the market's forbidden patterns; the last card shares a content word with the hook card.
7. Eval (V-29): `pnpm eval:reels` runs the 3 synthetic posts (a mistake callout in es-ES, a direct question in en, a contrarian hook in en) and writes a review sheet for the owner. The three scripts of the fake run cover 7 hook types between them.

## 7. Learning loop

- Carousels already record `content_variants.hook_type`, and plan 11 computes save and share lift by it. With the library the hook types become more distinct, so that report gets more useful.
- Reels: M8-07 records which option the owner picks; M8-10 adds Reel metrics (plays, watch time, completion, the hook or skip rate if the Graph API returns it) under the same `hook_type` dimension.
- Carousels publish more often than Reels, so their data arrives first. The best hook types per market from carousels can rank the Reel options before there is any Reel data.

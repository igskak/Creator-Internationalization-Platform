# Knowledge extractor: synthetic fixture and expected cards

Input: the four pages in `prompts/src/knowledge-extractor/fixtures.ts` (`FIXTURE_PAGES`, text mode, taxonomy `FIXTURE_TAXONOMY`). The pages are written for this project; they are not Reg.Chef material. A reference extraction is `FIXTURE_OUTPUT` in the same file. The eval harness (M2-16) scores a model run against the notes below, not against exact text.

## Expected cards

| Page | Card | Must hold |
|---|---|---|
| 2 | Buckwheat: do not lift the lid | category `GRAINS_RICE_PASTA`, subcategory `BUCKWHEAT`; ratio 1:2, 15 min, then 10 min off the heat; explanation = steam finishes the grain; quote verbatim |
| 2 | Buckwheat: do not stir (optional second card) | common mistake "stirring", why: grains break and get sticky; no extra advice |
| 2 | Salt before the water boils (optional) | claim as stated; no invented reason beyond "even flavour" |
| 3 | Rice: cooling and storage | category `STORAGE_SAFETY`; `safetySensitive = true` with a reason; 2 h at room temperature, fridge +4 °C, within a day |
| 3 | Rice: reheating (optional) | reheat once only; at least 74 °C inside; `safetySensitive = true` |

## Must not happen

- A card from page 1 (table of contents) or page 4 (course advertisement); both pages are listed in `skippedPages` with reasons `TABLE_OF_CONTENTS` and `MARKETING`.
- Any number, unit or temperature not on the pages, a converted unit (°F, cups), or "always / never / most common" wording the source does not use.
- A quote that is not a character-for-character substring of its page, or longer than 400 characters.
- A category or subcategory outside the taxonomy.
- Cards in a language other than Russian.

## Scoring ideas

Card recall against the table (required cards found), quote verification rate (target 100 %), numbers in `temperatures` and `timings` all found on the cited page (target 100 %), no cards from skipped pages, safety flag on both rice cards.

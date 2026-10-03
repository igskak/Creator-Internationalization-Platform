// Safety-sensitive detection (plan 07 §7.2.7): the model's own flag plus keyword rules in RU, ES
// and EN. A match only raises the flag for the reviewer; it never lowers one the model set.

export const SAFETY_RULES: { reason: string; pattern: RegExp }[] = [
  {
    reason: "raw or undercooked meat, fish or eggs",
    pattern:
      /сыр(?:ое|ой|ого|ым|ая|ые|ых)\s+(?:мяс|рыб|яйц|кур|свин|говяд)|сыр(?:ые|ых)\s+яйц|непрожар|недожар|недовар|с кровью|carne cruda|pescado crudo|huevos? crud|poco hech[oa]|poco cocinad|semicrud|\braw (?:meat|fish|eggs?|chicken|pork|beef|seafood)|undercooked|medium[- ]rare/iu,
  },
  {
    reason: "core or internal temperature",
    pattern:
      /температур\p{L}*\s+внутри|внутренн\p{L}+\s+температур|температур\p{L}*\s+в\s+центре|температур\p{L}*\s+ядр|температура interna|temperatura (?:interna|del núcleo|del nucleo)|(?:internal|core) temperature/iu,
  },
  {
    reason: "canning, preserving or fermenting",
    pattern:
      /консервир|консерв|стерилиз|закатк|квашен|ферментац|conserva(?:s|r|ción|cion)|esterili|encurtid|fermentad|\bcanning\b|home-?canned|\bpickling\b|fermenting/iu,
  },
  {
    reason: "botulism or other pathogens",
    pattern:
      /ботулизм|ботулин|сальмонелл|листери|кишечн\p{L}+ палоч|botulismo|salmonela|listeria|botulism|salmonella|\be\.? ?coli\b/iu,
  },
  {
    reason: "allergens",
    pattern: /аллерг|глютен|alérgen|alergen|alergi|allergen|allerg|gluten/iu,
  },
  {
    reason: "alcohol",
    pattern:
      /алкогол|спирт(?:ом|а|ы|н\p{L}*)?(?![\p{L}])|водк|коньяк|ликёр|ликер|\balcohol\b|licor|\bliquor\b|\bspirits\b/iu,
  },
];

/** Reasons whose keywords occur in `text` (empty when the text looks harmless). */
export function safetyReasons(text: string): string[] {
  return SAFETY_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.reason);
}

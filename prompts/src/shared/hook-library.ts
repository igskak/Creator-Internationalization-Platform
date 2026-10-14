// Hook library (docs/design/hook-library.md, M2-12b): patterns per `hook_type` code, written for
// carousels and reused by the Reels director (M8-03), and the banned hook patterns per language.
// The patterns come from a public hook list and the owner's brief; the lines are ours. Pure data
// and small helpers, no prompt in here: prompts render what they need from it, and the content
// validators use the banned lists, so the rule in the prompt and the check in code cannot drift.

export const HOOK_LANGUAGES = ["en", "es"] as const;
export type HookLanguage = (typeof HOOK_LANGUAGES)[number];

export type HookLibraryEntry = {
  /** How hooks of this type are built, one short line each. */
  patterns: readonly string[];
  /** `master_ideas.angle` codes this type fits best. */
  angles: readonly string[];
  /** Carousel cover lines. Illustrations of the shape, never to be copied. */
  examples: Readonly<Record<HookLanguage, readonly string[]>>;
};

export const HOOK_LIBRARY: Readonly<Record<string, HookLibraryEntry>> = {
  MISTAKE_CALLOUT: {
    patterns: [
      "name the number one mistake of the topic",
      "ask whether the reader still does a familiar thing, then say why to stop",
      "do not do X until you have done Y",
      "without X you will not get Y",
    ],
    angles: ["COMMON_MISTAKE", "TROUBLESHOOTING"],
    examples: {
      en: ["Stop rinsing your risotto rice."],
      es: ["Lavas el arroz del risotto. Ese es el error."],
    },
  },
  MYTH_BUST: {
    patterns: ["quote a popular belief, then say it is not always true or plainly wrong"],
    angles: ["MYTH_VS_FACT"],
    examples: {
      en: ['"Always rinse rice" is only half true.'],
      es: ['"Lava siempre el arroz" es media verdad.'],
    },
  },
  CONTRARIAN: {
    patterns: [
      "name the worst common advice of the topic",
      "say what to do instead of the popular thing",
    ],
    angles: ["MYTH_VS_FACT", "COMPARISON"],
    examples: {
      en: ["The worst pasta advice: oil in the water."],
      es: ["El peor consejo para la pasta: aceite en el agua."],
    },
  },
  CURIOSITY_GAP: {
    patterns: [
      "state a surprising true fact and promise what it changes",
      "did you know, then the thing the reader does not expect",
      "what happens when you do X",
    ],
    angles: ["SCIENCE_EXPLAINER", "INGREDIENT_SPOTLIGHT"],
    examples: {
      en: ["Bulgur is already cooked. That changes how you make it."],
      es: ["El bulgur ya viene cocido. Y eso cambia cómo se prepara."],
    },
  },
  RELATABLE_PROBLEM: {
    patterns: [
      "name a kitchen frustration the reader knows",
      "why your X turns out Y, with the cause on the next slide",
    ],
    angles: ["TROUBLESHOOTING", "SCIENCE_EXPLAINER"],
    examples: {
      en: ["Why your rice goes mushy."],
      es: ["Por qué tu arroz queda pastoso."],
    },
  },
  HOW_TO_PROMISE: {
    patterns: [
      "the easiest way to get a result",
      "want X? do this",
      "one action that gets the result",
      "the only way to get X without Y",
    ],
    angles: ["TECHNIQUE_HOW_TO", "QUICK_TIP"],
    examples: {
      en: ["The laziest way to fluffy bulgur."],
      es: ["La forma más fácil de un bulgur suelto."],
    },
  },
  NUMBER_OR_STAT: {
    patterns: [
      "N rules, tips, mistakes or signs of the topic, N being the real number of points in the carousel (3 to 5)",
      "a number that a card states",
    ],
    angles: ["CHECKLIST", "COMMON_MISTAKE"],
    examples: {
      en: ["3 ways to ruin a risotto."],
      es: ["3 formas de arruinar un risotto."],
    },
  },
  DIRECT_QUESTION: {
    patterns: [
      "ask a doubt about a familiar action; the next slide gives the rule",
      "what annoys most in the topic",
    ],
    angles: ["COMMON_MISTAKE", "QUICK_TIP"],
    examples: {
      en: ["Hot water on bulgur? Only if it's fine."],
      es: ["¿Agua hirviendo al bulgur? Solo si es fino."],
    },
  },
  BOLD_CLAIM: {
    patterns: [
      "the one thing you need for a result",
      "the main rule of the topic that everyone ignores",
    ],
    angles: ["QUICK_TIP", "TECHNIQUE_HOW_TO"],
    examples: {
      en: ["The one ratio every pot of rice needs."],
      es: ["La única proporción que necesita tu arroz."],
    },
  },
  BEFORE_AFTER: {
    patterns: ["the same thing with two results and the one difference that explains them"],
    angles: ["COMPARISON"],
    examples: {
      en: ["Same rice, two pots: only the water changed."],
      es: ["Mismo arroz, dos ollas: solo cambia el agua."],
    },
  },
};

/**
 * First cards of a Reel (at most 6 words, `**…**` marks the accent word) per hook type. The shape
 * of the card, not text to copy; the rule card that follows answers it.
 */
export const HOOK_REEL_CARDS: Readonly<
  Record<keyof typeof HOOK_LIBRARY, Readonly<Record<HookLanguage, readonly string[]>>>
> = {
  MISTAKE_CALLOUT: {
    en: ["STILL RINSING **RISOTTO RICE?**"],
    es: ["¿AÚN LAVAS EL ARROZ **DEL RISOTTO?**"],
  },
  MYTH_BUST: {
    en: ['"ALWAYS RINSE RICE." **NOT ALWAYS.**'],
    es: ['"LAVA SIEMPRE EL ARROZ." **NO SIEMPRE.**'],
  },
  CONTRARIAN: {
    en: ["THE **WORST** PASTA ADVICE"],
    es: ["EL **PEOR** CONSEJO PARA LA PASTA"],
  },
  CURIOSITY_GAP: {
    en: ["BULGUR IS **ALREADY COOKED.**"],
    es: ["EL BULGUR YA ESTÁ **COCIDO.**"],
  },
  RELATABLE_PROBLEM: {
    en: ["RICE STUCK TO THE **POT?**"],
    es: ["¿EL ARROZ SE **PEGA?**"],
  },
  HOW_TO_PROMISE: {
    en: ["WANT **NUTTY** BULGUR?"],
    es: ["¿BULGUR CON SABOR A **NUEZ?**"],
  },
  NUMBER_OR_STAT: {
    en: ["3 WAYS TO RUIN **RISOTTO**"],
    es: ["3 FORMAS DE ARRUINAR UN **RISOTTO**"],
  },
  DIRECT_QUESTION: {
    en: ["HOT WATER ON **BULGUR?**"],
    es: ["¿AGUA HIRVIENDO AL **BULGUR?**"],
  },
  BOLD_CLAIM: {
    en: ["ONE RULE FOR **FLUFFY** RICE"],
    es: ["UNA REGLA PARA UN ARROZ **SUELTO**"],
  },
  BEFORE_AFTER: {
    en: ["SAME RICE. **DIFFERENT** WATER."],
    es: ["MISMO ARROZ. **OTRA** AGUA."],
  },
};

/** "es-ES" / "es" → "es"; a language without a library entry → undefined. */
export function hookLanguage(language: string): HookLanguage | undefined {
  const base = language.toLowerCase().split(/[-_]/u)[0];
  return HOOK_LANGUAGES.find((l) => l === base);
}

/** One line for a prompt: the patterns and the best angles of a hook type (no examples). */
export function hookPatternsLine(code: string): string | undefined {
  const entry = HOOK_LIBRARY[code];
  if (!entry) return undefined;
  return `patterns: ${entry.patterns.join("; ")}. Fits angles: ${entry.angles.join(", ")}.`;
}

/**
 * The patterns plus example lines in the market's language: cover lines for the carousel writer,
 * first cards for the Reel director.
 */
export function hookGuidance(
  code: string,
  language: string,
  format: "carousel" | "reel" = "carousel",
): string | undefined {
  const entry = HOOK_LIBRARY[code];
  if (!entry) return undefined;
  const lang = hookLanguage(language);
  const examples = !lang
    ? []
    : format === "reel"
      ? (HOOK_REEL_CARDS[code]?.[lang] ?? [])
      : entry.examples[lang];
  return [
    hookPatternsLine(code),
    examples.length > 0
      ? `Shape only, never copy: ${examples.map((e) => `"${e}"`).join(" / ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export type BannedHookPattern = {
  /** Issue-message label of the group. */
  group: "INVENTED_EXPERIENCE" | "GUARANTEE" | "CONSPIRACY" | "TIME_PROMISE" | "EMPTY_HYPE";
  pattern: RegExp;
};

const word = (source: string) => new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, "iu");

/**
 * Hook patterns that promise or claim what the cards cannot back. Checked on the hook line and the
 * HOOK slide only (docs/design/hook-library.md §3). "My trick" is not here: a first-person chef
 * statement is allowed for a cited claim and the citation validator owns that rule.
 */
export const BANNED_HOOK_PATTERNS: Readonly<Record<HookLanguage, readonly BannedHookPattern[]>> = {
  en: [
    {
      group: "INVENTED_EXPERIENCE",
      pattern: word(
        String.raw`I (?:spent|tested|tried|ranked|learned the hard way)|what I(?:'d| would) do (?:if|when)`,
      ),
    },
    { group: "GUARANTEE", pattern: /\b100\s?%|(?<![\p{L}\d])10[x×](?![\p{L}\d])/iu },
    {
      group: "GUARANTEE",
      pattern: word(
        String.raw`guaranteed|always works|works (?:every time|for everyone|for anyone)`,
      ),
    },
    {
      group: "CONSPIRACY",
      pattern: word(
        String.raw`(?:experts|chefs|they) (?:are )?(?:hid(?:e|ing)|don'?t want you|won'?t tell you)|nobody (?:tells you|talks about|will tell you)|forbidden (?:trick|technique|method)`,
      ),
    },
    {
      group: "TIME_PROMISE",
      pattern: word(String.raw`in (?:a|one) (?:minute|week)|by tomorrow|this (?:week|month)`),
    },
    {
      group: "EMPTY_HYPE",
      pattern: word(
        String.raw`will change (?:your|the way|everything)|changes everything|game[- ]?changer|no fluff`,
      ),
    },
  ],
  es: [
    {
      group: "INVENTED_EXPERIENCE",
      pattern: word(
        String.raw`(?:he|hemos) (?:probado|testado)|pas[ée] \d+|llevo \d+ años|lo que haría (?:yo )?si`,
      ),
    },
    { group: "GUARANTEE", pattern: /\b100\s?%|(?<![\p{L}\d])10[x×](?![\p{L}\d])/iu },
    {
      group: "GUARANTEE",
      pattern: word(
        String.raw`garantizad[oa]|infalible|funciona (?:siempre|a la primera|para todos|para todo el mundo)`,
      ),
    },
    {
      group: "CONSPIRACY",
      pattern: word(
        String.raw`los (?:expertos|chefs) (?:ocultan|esconden|no quieren)|nadie (?:te )?(?:cuenta|dice|habla de)|truco prohibido|lo que no te cuentan`,
      ),
    },
    {
      group: "TIME_PROMISE",
      pattern: word(String.raw`en (?:un|una) (?:minuto|semana)|para mañana|este mes|esta semana`),
    },
    {
      group: "EMPTY_HYPE",
      pattern: word(String.raw`cambiar[áa] (?:tu|todo)|lo cambia todo|cambia las reglas del juego`),
    },
  ],
};

/** The banned patterns found in a text, by group. */
export function findBannedHookPatterns(
  text: string,
  language: HookLanguage,
): { group: BannedHookPattern["group"]; match: string }[] {
  const found: { group: BannedHookPattern["group"]; match: string }[] = [];
  for (const { group, pattern } of BANNED_HOOK_PATTERNS[language]) {
    const match = pattern.exec(text.normalize("NFC"));
    if (match) found.push({ group, match: match[0] });
  }
  return found;
}

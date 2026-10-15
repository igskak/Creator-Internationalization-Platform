import type { reelDirector } from "@rc/prompts";

// A valid answer of the Reel director for a rendered request (M8-07a): the fake model of the E2E
// server returns it, built from the slide ids, picture ids and hook types the request contains, so
// it passes `validateReelScript` for any carousel. Cards carry no numbers and no claims of their
// own; every RULE, STEP and PEAK scene cites slides of the request.

type Output = reelDirector.ReelDirectorOutput;

const CARDS = {
  en: {
    hooks: [
      ["Rinsing the **rice?**", "Skip it. The **starch** helps.", "Rinsing rice: a doubt"],
      ["Is this a **mistake?**", "Leave the **starch** on.", "A mistake callout"],
      ["Why is it **sticky?**", "That is the **starch**.", "A curiosity gap"],
    ],
    scenes: [
      "Watch the **starch**",
      "One pot, one **step**",
      "Creamy and **warm**",
      "Simple as that",
    ],
    ending: "Save this **rice** tip",
  },
  es: {
    hooks: [
      ["¿Lavar el **arroz?**", "No. El **almidón** ayuda.", "Una duda sobre el arroz"],
      ["¿Es un **error?**", "Deja el **almidón** puesto.", "Un error común"],
      ["¿Por qué se **pega?**", "Es el **almidón**.", "Una curiosidad"],
    ],
    scenes: [
      "Mira el **almidón**",
      "Una olla, un **paso**",
      "Meloso y **caliente**",
      "Así de simple",
    ],
    ending: "Guarda este truco del **arroz**",
  },
} as const;

const SHOT_PROMPTS = [
  "Static camera. Steam rises slowly from the bowl.",
  "Static camera. Grains tumble gently into the pot.",
  "Static camera. A thin stream of broth pours into the pan.",
  "Static camera. Bubbles rise and pop on the surface.",
  "Static camera. A spoon lifts a creamy scoop from the pan.",
  "Static camera. The finished dish settles with a soft glow.",
  "Static camera. Steam curls above the plate on the table.",
];

const unique = <T>(items: readonly T[]) => [...new Set(items)];

/** Builds the answer from the text of a `reel-director` request. */
export function scriptedReelScript(requestText: string): Output {
  const language = /<market [^>]*language="([^"]+)"/u.exec(requestText)?.[1] === "es" ? "es" : "en";
  const cards = CARDS[language];
  const slideIds = [...requestText.matchAll(/<slide id="([^"]+)"/gu)].map((m) => m[1] ?? "");
  const pictureIds = unique(
    [...requestText.matchAll(/<picture id="([^"]+)"/gu)].map((m) => m[1] ?? ""),
  );
  const hookTypes = unique(
    [
      ...(/<hook_types>([\s\S]*?)<\/hook_types>/u.exec(requestText)?.[1] ?? "").matchAll(
        /<term code="([^"]+)"/gu,
      ),
    ].map((m) => m[1] ?? ""),
  );
  // The first slide is the carousel's hook and states no claim; the others carry the facts.
  const claims = slideIds.length > 1 ? slideIds.slice(1, 3) : slideIds.slice(0, 1);
  const picture = (i: number) => pictureIds[i % pictureIds.length] ?? "";

  const hookOptions = cards.hooks.map(([card, ruleCard, rationale], i) => ({
    id: `h${i + 1}`,
    hookType: hookTypes[i] ?? hookTypes[0] ?? "",
    card,
    ruleCard,
    claimSlideIds: claims,
    rationale,
  }));
  const first = hookOptions[0] as (typeof hookOptions)[number];

  type Row = [
    role: Output["scenes"][number]["role"],
    emotion: Output["scenes"][number]["emotion"],
    beats: number,
    card: string,
    claims: string[],
  ];
  const rows: Row[] = [
    ["HOOK", "DOUBT", 4, first.card, []],
    ["RULE", "INTRIGUE", 4, first.ruleCard, claims],
    ["STEP", "AHA", 4, cards.scenes[0], claims],
    ["STEP", "USEFULNESS", 4, cards.scenes[1], claims],
    ["PEAK", "APPETITE", 4, cards.scenes[2], claims],
    ["PAYOFF", "DELIGHT", 3, cards.scenes[3], []],
    ["CTA", "SAVE_IT", 3, cards.ending, []],
  ];
  return {
    hookOptions,
    chosenHookId: first.id,
    flashOpener: "ON",
    scenes: rows.map(([role, emotion, beats, card, claimSlideIds], i) => ({
      id: `s${i + 1}`,
      role,
      emotion,
      beats,
      card,
      shotPrompt: SHOT_PROMPTS[i] ?? SHOT_PROMPTS[0] ?? "",
      sourcePictureId: picture(i),
      layout: "RIGHT" as const,
      claimSlideIds,
    })),
  };
}

import type { reelDirector } from "@rc/prompts";

// A valid answer of the Reel director for a rendered request (M8-07a): the fake model of the E2E
// server returns it, built from the slide ids, picture ids and hook types the request contains, so
// it passes `validateReelScript` for any carousel. Cards carry no numbers and no claims of their
// own; every RULE, STEP and PEAK scene cites slides of the request. A reel-director@2 request (it
// has <cta_types>) also gets the post: a caption without numbers, the first allowed ask and three
// hashtags that are not in <recent_hashtags>.

type Output = reelDirector.ReelDirectorOutput | reelDirector.ReelDirectorOutputV2;

const POST = {
  en: {
    caption: "Watch the starch: it does the work, so leave it on the grains.",
    asks: {
      SHARE: "Send this to whoever cooks the rice at home.",
      FOLLOW: "Follow for more kitchen rules like this one.",
      SAVE: "Save this for the next pot of rice.",
    } as Record<string, string>,
    tags: ["#ricetips", "#homecooking", "#kitchenrules", "#grains", "#cookingbasics"],
  },
  es: {
    caption: "Mira el almidón: hace el trabajo, así que déjalo en el grano.",
    asks: {
      SHARE: "Mándaselo a quien hace el arroz en casa.",
      FOLLOW: "Sígueme para más reglas de cocina como esta.",
      SAVE: "Guárdalo para la próxima olla de arroz.",
    } as Record<string, string>,
    tags: ["#trucosdecocina", "#arroz", "#cocinacasera", "#recetasfaciles", "#cocinafacil"],
  },
} as const;

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

/** The post of a reel-director@2 answer, or nothing for a v1 request. */
function scriptedPost(requestText: string, language: "en" | "es") {
  const types = /<cta_types>([\s\S]*?)<\/cta_types>/u.exec(requestText)?.[1];
  if (types === undefined) return {};
  const codes = [...types.matchAll(/<term code="([^"]+)"/gu)].map((m) => m[1] ?? "");
  const type = codes[0] ?? "SAVE";
  const carousel =
    /<post of="carousel">[\s\S]*?<cta type="([^"]+)"(?: keyword="([^"]+)")?>\n([\s\S]*?)\n<\/cta>/u.exec(
      requestText,
    );
  const post = POST[language];
  const kept = codes.length === 1 && carousel?.[1] === type;
  const ask = kept ? unescapeXml(carousel?.[3] ?? "") : (post.asks[type] ?? post.asks.SAVE ?? "");
  const recent = new Set(
    [
      ...(/<recent_hashtags>([\s\S]*?)<\/recent_hashtags>/u.exec(requestText)?.[1] ?? "").matchAll(
        /<tag>\n([^\n]+)\n<\/tag>/gu,
      ),
    ].map((m) => (m[1] ?? "").toLowerCase()),
  );
  const fresh = post.tags.filter((t) => !recent.has(t));
  const hashtags = [...fresh, ...post.tags.filter((t) => recent.has(t))].slice(0, 3);
  return {
    caption: `${post.caption}\n\n${ask}`,
    cta: { type, text: ask, ...(kept && carousel?.[2] ? { keyword: carousel[2] } : {}) },
    hashtags,
  };
}

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
  "Static camera. A thin stream of broth pours into the pan.",
  "Static camera. Grains tumble gently into the pot.",
  "Static camera. Steam rises slowly from the bowl.",
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
    ...scriptedPost(requestText, language),
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

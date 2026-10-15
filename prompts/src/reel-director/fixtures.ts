import type { ReelDirectorInput, ReelDirectorOutput, ReelDirectorScene } from "./schema";
import type { ReelDirectorInputV2, ReelDirectorOutputV2, ReelPostCta } from "./v2";

// Synthetic posts for the Reel director: the inputs of its tests and evals (three carousels in two
// languages) and a valid answer for each, which the scripted fake model returns and the validators
// accept. The facts are made up for the test; nothing here is a real recipe claim.

const HOOK_TYPES = [
  { code: "MISTAKE_CALLOUT", label: "Mistake callout" },
  { code: "MYTH_BUST", label: "Myth bust" },
  { code: "CONTRARIAN", label: "Contrarian" },
  { code: "CURIOSITY_GAP", label: "Curiosity gap" },
  { code: "RELATABLE_PROBLEM", label: "Relatable problem" },
  { code: "HOW_TO_PROMISE", label: "How-to promise" },
  { code: "DIRECT_QUESTION", label: "Direct question" },
  { code: "NUMBER_OR_STAT", label: "Number or stat" },
];

const slide = (id: string, role: string, text: string, factual = true, cards: string[] = []) => ({
  id,
  role,
  text,
  factual,
  knowledgeIds: cards,
});

type SceneRow = [
  role: ReelDirectorScene["role"],
  emotion: ReelDirectorScene["emotion"],
  beats: number,
  card: string,
  motion: string,
  picture: string,
  claims: string[],
];

const scenes = (rows: SceneRow[]): ReelDirectorScene[] =>
  rows.map(([role, emotion, beats, card, shotPrompt, sourcePictureId, claimSlideIds], i) => ({
    id: `s${i + 1}`,
    role,
    emotion,
    beats,
    card,
    shotPrompt,
    sourcePictureId,
    layout: "RIGHT",
    claimSlideIds,
  }));

/** A post of the eval set: reel-director@2's input and answer (v1 reads the same input). */
export type ReelPost = {
  key: string;
  input: ReelDirectorInputV2;
  output: ReelDirectorOutputV2;
};

// 1 · es-ES: risotto rice that is not rinsed (mistake callout)
const RISOTTO_INPUT: ReelDirectorInput = {
  market: { code: "es-ES", displayName: "Spain", language: "es" },
  carousel: {
    hook: "Lavas el arroz del risotto. Ese es el error.",
    hookType: "MISTAKE_CALLOUT",
    slides: [
      slide("c1", "HOOK", "Lavas el arroz del risotto. Ese es el error.", false),
      slide(
        "c2",
        "PROBLEM",
        "El almidón de la superficie es lo que hace el risotto meloso.",
        true,
        ["k1"],
      ),
      slide("c3", "EXPLANATION", "Si lo lavas, el almidón se va y el arroz queda suelto.", true, [
        "k1",
      ]),
      slide("c4", "STEP", "Tuesta el arroz en seco 2 min antes de añadir el caldo.", true, ["k2"]),
      slide(
        "c5",
        "STEP",
        "Añade el caldo caliente, un cucharón cada vez, sin dejar de remover.",
        true,
        ["k2"],
      ),
      slide("c6", "CTA", "Guárdalo para tu próximo risotto.", false),
    ],
  },
  pictures: [
    {
      id: "p1",
      slideId: "c1",
      description: "Dry arborio rice grains in a white bowl, side light.",
    },
    { id: "p2", slideId: "c3", description: "Rice rinsed in a metal sieve under running water." },
    { id: "p3", slideId: "c4", description: "Rice grains toasting in a dry pan." },
    { id: "p4", slideId: "c5", description: "Hot stock poured from a ladle into a pan of rice." },
    { id: "p5", slideId: "c6", description: "A finished creamy risotto on a white plate." },
    { id: "p6", slideId: "c4", description: "Close-up of toasted rice grains sizzling in a pan." },
  ],
  brief: {
    tone: "Cálido y directo, tuteo.",
    terminology: [{ concept: "creamy", localTerm: "meloso" }],
    ctaType: "SAVE",
  },
  taxonomy: { hookTypes: HOOK_TYPES },
  recentHookTypes: ["MYTH_BUST"],
};

const RISOTTO_OUTPUT: ReelDirectorOutput = {
  hookOptions: [
    {
      id: "h1",
      hookType: "MISTAKE_CALLOUT",
      card: "¿Aún lavas el arroz **del risotto?**",
      ruleCard: "Ahí se va lo **meloso.**",
      claimSlideIds: ["c2", "c3"],
      rationale: "Doubts a familiar action, then names what is lost.",
    },
    {
      id: "h2",
      hookType: "CURIOSITY_GAP",
      card: "El secreto del risotto: el **almidón.**",
      ruleCard: "No lo tires por el **desagüe.**",
      claimSlideIds: ["c2"],
      rationale: "Promises a hidden reason, then gives the rule.",
    },
    {
      id: "h3",
      hookType: "RELATABLE_PROBLEM",
      card: "¿Tu risotto queda **suelto?**",
      ruleCard: "Mira qué haces con el **arroz.**",
      claimSlideIds: ["c3"],
      rationale: "Names the frustration, then points to the cause.",
    },
  ],
  chosenHookId: "h1",
  flashOpener: "ON",
  scenes: scenes([
    [
      "HOOK",
      "DOUBT",
      4,
      "¿Aún lavas el arroz **del risotto?**",
      "Static camera. Water streams through a metal sieve of dry rice grains.",
      "p2",
      [],
    ],
    [
      "RULE",
      "INTRIGUE",
      3,
      "Ahí se va lo **meloso.**",
      "Static camera. Cloudy rinse water swirls around dry rice grains in a white bowl.",
      "p1",
      ["c2", "c3"],
    ],
    [
      "STEP",
      "AHA",
      4,
      "El almidón **lo hace cremoso.**",
      "Static camera. Cloudy water drains through the metal sieve of rice grains.",
      "p2",
      ["c2"],
    ],
    [
      "STEP",
      "USEFULNESS",
      4,
      "Tuesta en seco. **2 min.**",
      "Static camera. A wooden spoon turns rice grains in a dry pan.",
      "p3",
      ["c4"],
    ],
    [
      "PEAK",
      "APPETITE",
      5,
      "Huele a **pan tostado.**",
      "Static camera. Steam rises from toasted rice grains sizzling in the pan.",
      "p6",
      ["c4"],
    ],
    [
      "PAYOFF",
      "DELIGHT",
      4,
      "Caldo caliente, **cucharón a cucharón.**",
      "Static camera. Hot stock pours from a ladle onto the rice in the pan.",
      "p4",
      ["c5"],
    ],
    [
      "CTA",
      "SAVE_IT",
      4,
      "No laves el arroz. **Guárdalo.**",
      "Static camera. Steam rises from a creamy risotto on a white plate.",
      "p5",
      [],
    ],
  ]),
};

// 2 · en: bulgur and hot water (direct question)
const BULGUR_INPUT: ReelDirectorInput = {
  market: { code: "en", displayName: "United States", language: "en" },
  carousel: {
    hook: "Hot water on bulgur? Only if it's fine.",
    hookType: "DIRECT_QUESTION",
    slides: [
      slide("c1", "HOOK", "Hot water on bulgur? Only if it's fine.", false),
      slide(
        "c2",
        "FACT",
        "Fine bulgur is already cooked, so hot water is enough to soften it.",
        true,
        ["k1"],
      ),
      slide("c3", "FACT", "Coarse bulgur needs simmering with a lid on.", true, ["k1"]),
      slide("c4", "STEP", "Toast the dry grains first for a nutty taste.", true, ["k2"]),
      slide("c5", "STEP", "Rest it for 10 min with the lid on, then fluff with a fork.", true, [
        "k2",
      ]),
      slide("c6", "CTA", "Save this for your next grain bowl.", false),
    ],
  },
  pictures: [
    {
      id: "p1",
      slideId: "c1",
      description: "Fine bulgur in a glass bowl with a kettle in the background.",
    },
    { id: "p2", slideId: "c3", description: "Coarse bulgur simmering in a pot with a lid." },
    { id: "p3", slideId: "c4", description: "Dry bulgur grains toasting in a pan." },
    { id: "p4", slideId: "c5", description: "Cooked bulgur fluffed in a bowl." },
    { id: "p5", slideId: "c2", description: "Close-up of fine bulgur soaking in hot water." },
    { id: "p6", slideId: "c4", description: "Close-up of golden toasted bulgur grains in a pan." },
  ],
  brief: { tone: "Warm and direct.", terminology: [], ctaType: "SAVE" },
  taxonomy: { hookTypes: HOOK_TYPES },
  recentHookTypes: [],
};

const BULGUR_OUTPUT: ReelDirectorOutput = {
  hookOptions: [
    {
      id: "h1",
      hookType: "DIRECT_QUESTION",
      card: "Hot water on **bulgur?**",
      ruleCard: "Only if it's **fine.**",
      claimSlideIds: ["c2", "c3"],
      rationale: "Doubts a familiar action, then gives the condition.",
    },
    {
      id: "h2",
      hookType: "CURIOSITY_GAP",
      card: "Fine bulgur is **already cooked.**",
      ruleCard: "So skip the **boiling.**",
      claimSlideIds: ["c2"],
      rationale: "A surprising fact, then what it changes.",
    },
    {
      id: "h3",
      hookType: "HOW_TO_PROMISE",
      card: "Want **nutty** bulgur?",
      ruleCard: "Toast it **dry** first.",
      claimSlideIds: ["c4"],
      rationale: "A sensory promise, then the one action.",
    },
  ],
  chosenHookId: "h1",
  flashOpener: "ON",
  scenes: scenes([
    [
      "HOOK",
      "DOUBT",
      4,
      "Hot water on **bulgur?**",
      "Static camera. Steaming water pours from a kettle into a glass bowl of bulgur.",
      "p1",
      [],
    ],
    [
      "RULE",
      "INTRIGUE",
      3,
      "Only if it's **fine.**",
      "Static camera. Bulgur grains swell slowly in the hot water.",
      "p5",
      ["c2"],
    ],
    [
      "STEP",
      "AHA",
      4,
      "Coarse? **Simmer it.**",
      "Static camera. Bubbles rise around coarse bulgur in a pot with a lid beside it.",
      "p2",
      ["c3"],
    ],
    [
      "STEP",
      "USEFULNESS",
      4,
      "Toast the **dry grains.**",
      "Static camera. A wooden spoon turns dry bulgur grains in a pan.",
      "p3",
      ["c4"],
    ],
    [
      "PEAK",
      "APPETITE",
      5,
      "Nutty. Toasty. **Like bread.**",
      "Static camera. Steam rises from golden bulgur grains sizzling in the pan.",
      "p6",
      ["c4"],
    ],
    [
      "PAYOFF",
      "RELIEF",
      4,
      "Rest it **10 min.**",
      "Static camera. A lid closes over the pot of bulgur and steam escapes at the edge.",
      "p2",
      ["c5"],
    ],
    [
      "CTA",
      "SAVE_IT",
      4,
      "Save the **bulgur** rule.",
      "Static camera. A fork fluffs cooked bulgur in a bowl and steam rises.",
      "p4",
      [],
    ],
  ]),
};

// 3 · en: oil in the pasta water (contrarian)
const PASTA_INPUT: ReelDirectorInput = {
  market: { code: "en", displayName: "United States", language: "en" },
  carousel: {
    hook: "The worst pasta advice: oil in the water.",
    hookType: "CONTRARIAN",
    slides: [
      slide("c1", "HOOK", "The worst pasta advice: oil in the water.", false),
      slide(
        "c2",
        "FACT",
        "Oil floats on top of the water and does not stop pasta from sticking.",
        true,
        ["k1"],
      ),
      slide("c3", "FACT", "Stir the pasta in the first minute so it does not stick.", true, ["k1"]),
      slide("c4", "STEP", "Salt the water well: it seasons the pasta from the inside.", true, [
        "k2",
      ]),
      slide("c5", "STEP", "Save a cup of the starchy water for the sauce.", true, ["k2"]),
      slide("c6", "CTA", "Save this before your next pasta night.", false),
    ],
  },
  pictures: [
    { id: "p1", slideId: "c1", description: "Oil drops floating on boiling water in a pot." },
    {
      id: "p2",
      slideId: "c3",
      description: "Spaghetti stirred in a pot of boiling water with a wooden spoon.",
    },
    { id: "p3", slideId: "c4", description: "Coarse salt poured into a pot of water." },
    {
      id: "p4",
      slideId: "c5",
      description: "A glass cup dipped into a pot of cloudy pasta water.",
    },
    { id: "p5", slideId: "c6", description: "Glossy spaghetti with sauce on a white plate." },
    { id: "p6", slideId: "c2", description: "Steam rising over a pot of boiling spaghetti." },
  ],
  brief: { tone: "Direct, a little playful.", terminology: [], ctaType: "SAVE" },
  taxonomy: { hookTypes: HOOK_TYPES },
  recentHookTypes: ["DIRECT_QUESTION", "CURIOSITY_GAP"],
};

const PASTA_OUTPUT: ReelDirectorOutput = {
  hookOptions: [
    {
      id: "h1",
      hookType: "CONTRARIAN",
      card: "The **worst** pasta advice",
      ruleCard: "Oil floats. **It does nothing.**",
      claimSlideIds: ["c2"],
      rationale: "Names the popular advice, then busts it.",
    },
    {
      id: "h2",
      hookType: "MYTH_BUST",
      card: '"Oil stops sticking." **Not true.**',
      ruleCard: "**Stir** in the first minute.",
      claimSlideIds: ["c2", "c3"],
      rationale: "Quotes the belief, then gives the real fix.",
    },
    {
      id: "h3",
      hookType: "RELATABLE_PROBLEM",
      card: "Pasta stuck **together?**",
      ruleCard: "It's not the **oil.**",
      claimSlideIds: ["c2"],
      rationale: "Names the frustration, then the cause.",
    },
  ],
  chosenHookId: "h1",
  flashOpener: "OFF",
  scenes: scenes([
    [
      "HOOK",
      "DOUBT",
      4,
      "The **worst** pasta advice",
      "Static camera. Drops of oil spread across the surface of boiling water in a pot.",
      "p1",
      [],
    ],
    [
      "RULE",
      "SURPRISE",
      3,
      "Oil floats. **It does nothing.**",
      "Static camera. Oil drops drift across the water while the pasta below stays still.",
      "p6",
      ["c2"],
    ],
    [
      "STEP",
      "AHA",
      4,
      "**Stir** in minute one.",
      "Static camera. A wooden spoon stirs spaghetti in boiling water.",
      "p2",
      ["c3"],
    ],
    [
      "STEP",
      "USEFULNESS",
      4,
      "Salt it **well.**",
      "Static camera. Coarse salt pours into the pot of water.",
      "p3",
      ["c4"],
    ],
    [
      "PEAK",
      "APPETITE",
      5,
      "Salted from the **inside.**",
      "Static camera. Steam rises from the pot as the spaghetti turns in the water.",
      "p6",
      ["c4"],
    ],
    [
      "PAYOFF",
      "RELIEF",
      4,
      "Save a cup of **starchy water.**",
      "Static camera. A glass cup dips into the cloudy pasta water and lifts out.",
      "p4",
      ["c5"],
    ],
    [
      "CTA",
      "SAVE_IT",
      4,
      "Save this **pasta** rule.",
      "Static camera. Steam rises from glossy spaghetti with sauce on a white plate.",
      "p5",
      [],
    ],
  ]),
};

// --- The post of each Reel (reel-director@2) ------------------------------------------------

const CTA_TYPES = [
  { code: "SHARE", label: "Share" },
  { code: "FOLLOW", label: "Follow" },
  { code: "SAVE", label: "Save" },
];

const withPost = (
  input: ReelDirectorInput,
  carousel: { caption: string; cta: ReelPostCta },
  recent: { ctaTypes: string[]; hashtags: string[] },
): ReelDirectorInputV2 => ({
  ...input,
  carousel: { ...input.carousel, ...carousel },
  ctaTypes: CTA_TYPES,
  recentCtaTypes: recent.ctaTypes,
  recentHashtags: recent.hashtags,
});

const RISOTTO_INPUT_V2 = withPost(
  RISOTTO_INPUT,
  {
    caption:
      "¿Lavas el arroz del risotto? Ahí se va lo meloso.\n\nEl almidón de la superficie es lo que hace el risotto meloso. Tuesta el arroz en seco 2 min y añade el caldo caliente, un cucharón cada vez.\n\nGuárdalo para tu próximo risotto.",
    cta: { type: "SAVE", text: "Guárdalo para tu próximo risotto." },
  },
  { ctaTypes: ["SAVE", "SAVE"], hashtags: ["#cocinacasera", "#recetasfaciles", "#trucosdecocina"] },
);
const RISOTTO_OUTPUT_V2: ReelDirectorOutputV2 = {
  ...RISOTTO_OUTPUT,
  caption:
    "El almidón de la superficie es lo que hace el risotto meloso. Si lo lavas, el almidón se va y el arroz queda suelto.\n\nTuesta el arroz en seco 2 min y añade el caldo caliente, un cucharón cada vez, sin dejar de remover.\n\nMándaselo a quien hace el risotto en casa.",
  cta: { type: "SHARE", text: "Mándaselo a quien hace el risotto en casa." },
  hashtags: ["#risotto", "#arroz", "#trucosdecocina", "#cocinacasera"],
};

const BULGUR_INPUT_V2 = withPost(
  BULGUR_INPUT,
  {
    caption:
      "Hot water on bulgur? Only if it's fine.\n\nFine bulgur is already cooked, so hot water is enough to soften it. Coarse bulgur needs simmering with a lid on. Rest it for 10 min with the lid on, then fluff with a fork.\n\nSave this for your next grain bowl.",
    cta: { type: "SAVE", text: "Save this for your next grain bowl." },
  },
  { ctaTypes: ["SAVE"], hashtags: ["#cookingtips", "#mealprep", "#grainbowl", "#homecooking"] },
);
const BULGUR_OUTPUT_V2: ReelDirectorOutputV2 = {
  ...BULGUR_OUTPUT,
  caption:
    "Fine bulgur is already cooked, so hot water is enough to soften it. Coarse bulgur needs simmering with a lid on.\n\nToast the dry grains first for a nutty taste, then rest it for 10 min with the lid on and fluff with a fork.\n\nFollow for more grain rules like this one.",
  cta: { type: "FOLLOW", text: "Follow for more grain rules like this one." },
  hashtags: ["#bulgur", "#wholegrains", "#grainbowl", "#cookingtips"],
};

const PASTA_INPUT_V2 = withPost(
  PASTA_INPUT,
  {
    caption:
      "The worst pasta advice: oil in the water.\n\nOil floats on top of the water and does not stop pasta from sticking. Stir in the first minute, salt the water well and save a cup of the starchy water for the sauce.\n\nSave this before your next pasta night.",
    cta: { type: "SAVE", text: "Save this before your next pasta night." },
  },
  { ctaTypes: ["SAVE", "FOLLOW"], hashtags: ["#cookingtips", "#weeknightdinner"] },
);
const PASTA_OUTPUT_V2: ReelDirectorOutputV2 = {
  ...PASTA_OUTPUT,
  caption:
    "Oil floats on top of the water and does not stop pasta from sticking. What does: stirring the pasta in the first minute.\n\nSalt the water well, it seasons the pasta from the inside, and save a cup of the starchy water for the sauce.\n\nSend this to whoever still pours oil in the pasta pot.",
  cta: { type: "SHARE", text: "Send this to whoever still pours oil in the pasta pot." },
  hashtags: ["#pasta", "#pastatips", "#spaghetti", "#cookingtips"],
};

/** The three synthetic posts of the eval set. */
export const REEL_POSTS: readonly ReelPost[] = [
  { key: "risotto-rice", input: RISOTTO_INPUT_V2, output: RISOTTO_OUTPUT_V2 },
  { key: "bulgur-hot-water", input: BULGUR_INPUT_V2, output: BULGUR_OUTPUT_V2 },
  { key: "pasta-oil", input: PASTA_INPUT_V2, output: PASTA_OUTPUT_V2 },
];

/** reel-director@1's fixture (its snapshot). */
export const FIXTURE_INPUT: ReelDirectorInput = RISOTTO_INPUT;
export const FIXTURE_OUTPUT: ReelDirectorOutput = RISOTTO_OUTPUT;
/** reel-director@2's fixture. */
export const FIXTURE_INPUT_V2: ReelDirectorInputV2 = RISOTTO_INPUT_V2;
export const FIXTURE_OUTPUT_V2: ReelDirectorOutputV2 = RISOTTO_OUTPUT_V2;

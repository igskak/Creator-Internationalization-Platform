import type { ReelDirectorInput, ReelDirectorOutput, ReelDirectorScene } from "./schema";
import type { ReelDirectorInputV2, ReelDirectorOutputV2, ReelPostCta } from "./v2";
import type { ReelDirectorOutputV4, ReelDirectorSceneV4 } from "./v4";

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
      "Static camera. Bubbles rise and burst as drops of oil spread across boiling water in a pot.",
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

/** The three synthetic posts of the eval set (v1/v2 tests); the chocolate trap is separate. */
export const REEL_POSTS: readonly ReelPost[] = [
  { key: "risotto-rice", input: RISOTTO_INPUT_V2, output: RISOTTO_OUTPUT_V2 },
  { key: "bulgur-hot-water", input: BULGUR_INPUT_V2, output: BULGUR_OUTPUT_V2 },
  { key: "pasta-oil", input: PASTA_INPUT_V2, output: PASTA_OUTPUT_V2 },
];

// 4 · en: melted chocolate and a drop of water (curiosity gap). The trap for reel-director@3: the
// carousel's first picture is a near-still pile of ingredients (the hook slide's own picture), and
// the pictures that move are on later slides (a drop falling, a ribbon of chocolate falling from a
// spoon). The hook shot has to come from the ribbon, not from the first picture.
const CHOCOLATE_INPUT: ReelDirectorInput = {
  market: { code: "en", displayName: "United States", language: "en" },
  carousel: {
    hook: "One drop of water ruins melted chocolate.",
    hookType: "CURIOSITY_GAP",
    slides: [
      slide("c1", "HOOK", "One drop of water ruins melted chocolate.", false),
      slide(
        "c2",
        "FACT",
        "A little water makes melted chocolate seize into a grainy paste.",
        true,
        ["k1"],
      ),
      slide("c3", "FACT", "Keep the bowl and the spoon completely dry.", true, ["k1"]),
      slide("c4", "STEP", "Melt it over barely simmering water, never boiling.", true, ["k2"]),
      slide("c5", "STEP", "Stir slowly until the chocolate is smooth and glossy.", true, ["k2"]),
      slide("c6", "CTA", "Save this before you melt chocolate again.", false),
    ],
  },
  pictures: [
    {
      id: "p1",
      slideId: "c1",
      description:
        "Dark chocolate pieces and ice cubes in a glass of water side by side on a white table, nothing moving.",
    },
    {
      id: "p2",
      slideId: "c2",
      description: "A single drop of water falling toward a glass bowl of melted chocolate.",
    },
    {
      id: "p3",
      slideId: "c3",
      description: "A dry glass bowl and a dry spoon next to dark chocolate pieces.",
    },
    {
      id: "p4",
      slideId: "c4",
      description: "A glass bowl of chocolate pieces over a pot of barely simmering water.",
    },
    {
      id: "p5",
      slideId: "c5",
      description: "A spatula stirring smooth melted chocolate in a glass bowl.",
    },
    {
      id: "p6",
      slideId: "c5",
      description: "A thick ribbon of melted chocolate falling from a spoon into a glass bowl.",
    },
    {
      id: "p7",
      slideId: "c6",
      description: "Glossy melted chocolate poured over a strawberry on a white plate.",
    },
  ],
  brief: { tone: "Direct, a little playful.", terminology: [], ctaType: "SAVE" },
  taxonomy: { hookTypes: HOOK_TYPES },
  recentHookTypes: ["MYTH_BUST"],
};

const CHOCOLATE_INPUT_V2 = withPost(
  CHOCOLATE_INPUT,
  {
    caption:
      "One drop of water ruins melted chocolate.\n\nA little water makes melted chocolate seize into a grainy paste. Keep the bowl and the spoon completely dry.\n\nSave this before you melt chocolate again.",
    cta: { type: "SAVE", text: "Save this before you melt chocolate again." },
  },
  { ctaTypes: ["SAVE", "FOLLOW"], hashtags: ["#cookingtips", "#weeknightdinner"] },
);

const CHOCOLATE_OUTPUT_V2: ReelDirectorOutputV2 = {
  hookOptions: [
    {
      id: "h1",
      hookType: "CURIOSITY_GAP",
      card: "One drop of **water?**",
      ruleCard: "It makes chocolate **seize.**",
      claimSlideIds: ["c2"],
      rationale: "Asks what one drop does, then answers with the rule.",
    },
    {
      id: "h2",
      hookType: "MISTAKE_CALLOUT",
      card: "A wet spoon in **chocolate?**",
      ruleCard: "Keep everything **dry.**",
      claimSlideIds: ["c3"],
      rationale: "Doubts a small habit, then gives the fix.",
    },
    {
      id: "h3",
      hookType: "RELATABLE_PROBLEM",
      card: "Chocolate gone **grainy?**",
      ruleCard: "Blame the **water.**",
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
      5,
      "One drop of **water?**",
      "Static camera. Melted chocolate falls from a spoon in a thick ribbon into a glass bowl.",
      "p6",
      [],
    ],
    [
      "RULE",
      "INTRIGUE",
      3,
      "It makes chocolate **seize.**",
      "Static camera. A drop of water falls onto melted chocolate in a glass bowl.",
      "p2",
      ["c2"],
    ],
    [
      "STEP",
      "AHA",
      4,
      "Dry bowl. **Dry spoon.**",
      "Static camera. A dry spoon stirs dark chocolate pieces in a dry glass bowl.",
      "p3",
      ["c3"],
    ],
    [
      "STEP",
      "USEFULNESS",
      4,
      "Barely simmering. **Never boiling.**",
      "Static camera. Water simmers gently under a glass bowl of chocolate pieces.",
      "p4",
      ["c4"],
    ],
    [
      "PEAK",
      "APPETITE",
      5,
      "Stir until **glossy.**",
      "Static camera. A spatula stirs smooth melted chocolate in a glass bowl.",
      "p5",
      ["c5"],
    ],
    [
      "PAYOFF",
      "DELIGHT",
      4,
      "Smooth, glossy, **no water.**",
      "Static camera. Glossy melted chocolate pours over a strawberry on a white plate.",
      "p7",
      [],
    ],
    [
      "CTA",
      "SAVE_IT",
      4,
      "Save it. **Mind the water.**",
      "Static camera. Glossy chocolate drips from a spoon into the glass bowl.",
      "p6",
      [],
    ],
  ]),
  caption:
    "A little water makes melted chocolate seize into a grainy paste. Keep the bowl and the spoon completely dry.\n\nMelt it over barely simmering water, never boiling, and stir slowly until it is smooth and glossy.\n\nSend this to whoever melts chocolate at home.",
  cta: { type: "SHARE", text: "Send this to whoever melts chocolate at home." },
  hashtags: ["#chocolate", "#meltingchocolate", "#bakingtips", "#cookingtips"],
};

/**
 * The trap post of reel-director@3 (a still first picture, moving ones on later slides). It is kept
 * out of REEL_POSTS, whose three posts the older tests count; the Reel evals run it as well.
 */
export const CHOCOLATE_POST: ReelPost = {
  key: "chocolate-drop",
  input: CHOCOLATE_INPUT_V2,
  output: CHOCOLATE_OUTPUT_V2,
};

/** The posts of a Reel eval: the three of REEL_POSTS and the chocolate trap. */
export const REEL_EVAL_POSTS: readonly ReelPost[] = [...REEL_POSTS, CHOCOLATE_POST];

/** reel-director@1's fixture (its snapshot). */
export const FIXTURE_INPUT: ReelDirectorInput = RISOTTO_INPUT;
export const FIXTURE_OUTPUT: ReelDirectorOutput = RISOTTO_OUTPUT;
/** reel-director@2's fixture. */
export const FIXTURE_INPUT_V2: ReelDirectorInputV2 = RISOTTO_INPUT_V2;
export const FIXTURE_OUTPUT_V2: ReelDirectorOutputV2 = RISOTTO_OUTPUT_V2;

// --- reel-director@4 --------------------------------------------------------------------------
// The same four posts answered in the v4 format: six scenes of 3 to 3.5 s, a line of use under each
// card (none on the hook), a frame prompt per scene (pale food in dark cookware), a summary at the
// end. The hook options, the chosen hook and the post are v2's.

type SceneRowV4 = [
  role: ReelDirectorSceneV4["role"],
  emotion: ReelDirectorSceneV4["emotion"],
  beats: number,
  card: string,
  line: string,
  frame: string,
  motion: string,
  picture: string,
  claims: string[],
];

const scenesV4 = (rows: SceneRowV4[]): ReelDirectorSceneV4[] =>
  rows.map(
    (
      [role, emotion, beats, card, line, framePrompt, shotPrompt, sourcePictureId, claimSlideIds],
      i,
    ) => ({
      id: `s${i + 1}`,
      role,
      emotion,
      beats,
      card,
      line,
      framePrompt,
      shotPrompt,
      sourcePictureId,
      layout: "FULL",
      claimSlideIds,
    }),
  );

const v4Of = (output: ReelDirectorOutputV2, rows: SceneRowV4[]): ReelDirectorOutputV4 => ({
  ...output,
  flashOpener: "OFF",
  scenes: scenesV4(rows),
});

const RISOTTO_OUTPUT_V4 = v4Of(RISOTTO_OUTPUT_V2, [
  [
    "HOOK",
    "DOUBT",
    7,
    "¿Aún lavas el arroz **del risotto?**",
    "",
    "A dark metal sieve of arborio rice over a black enamel bowl, water running through the grains.",
    "Static camera. Water streams through the sieve of rice and drains away cloudy with starch. Sound of running water.",
    "p2",
    [],
  ],
  [
    "RULE",
    "INTRIGUE",
    6,
    "Ahí se va lo **meloso.**",
    "El almidón de la superficie es lo que hace el risotto meloso.",
    "Arborio rice grains in cloudy, starchy water in a charcoal ceramic bowl.",
    "Static camera. Cloudy rinse water swirls around the rice grains in the bowl. Soft swishing sound.",
    "p1",
    ["c2", "c3"],
  ],
  [
    "STEP",
    "AHA",
    6,
    "No lo laves. **Tuéstalo.**",
    "Tuesta el arroz en seco 2 min antes del caldo.",
    "Dry arborio rice grains in a black cast-iron pan, a wooden spoon resting in them.",
    "Static camera. A wooden spoon turns the rice grains in the dry pan. Soft rattle of grains.",
    "p3",
    ["c4"],
  ],
  [
    "STEP",
    "USEFULNESS",
    6,
    "Caldo caliente, **cucharón a cucharón.**",
    "Un cucharón cada vez, sin dejar de remover.",
    "Toasted arborio rice in a black cast-iron pan, a steel ladle of hot stock just above it.",
    "Static camera. Hot stock pours from the ladle onto the rice and bubbles up. Sound of pouring and a soft sizzle.",
    "p4",
    ["c5"],
  ],
  [
    "PEAK",
    "APPETITE",
    6,
    "Así sale **meloso.**",
    "El almidón se queda en la cazuela y hace el risotto meloso.",
    "Creamy, glossy risotto in a black cast-iron pan, a wooden spoon in it.",
    "Static camera. A wooden spoon stirs the creamy risotto; it folds and flows. Soft creamy stirring sound.",
    "p6",
    ["c2"],
  ],
  [
    "PAYOFF",
    "SAVE_IT",
    7,
    "No laves el arroz **del risotto.**",
    "Sin lavar, tostado, caldo a cucharones. Mándaselo a quien lo hace en casa.",
    "A creamy risotto on a dark charcoal stoneware plate.",
    "Static camera. Steam rises and curls over the creamy risotto on the plate. Soft simmer sound.",
    "p5",
    ["c3", "c5"],
  ],
]);

const BULGUR_OUTPUT_V4 = v4Of(BULGUR_OUTPUT_V2, [
  [
    "HOOK",
    "DOUBT",
    7,
    "Hot water on **bulgur?**",
    "",
    "Fine bulgur in a black stoneware bowl, the spout of a steel kettle just above it.",
    "Static camera. Steaming water pours from the kettle into the bowl of fine bulgur and the grains swirl. Sound of pouring water.",
    "p1",
    [],
  ],
  [
    "RULE",
    "INTRIGUE",
    6,
    "Only if it's **fine.**",
    "Fine bulgur is already cooked: hot water is enough.",
    "Fine bulgur soaking in hot water in a black stoneware bowl, steam rising.",
    "Static camera. The fine grains swell slowly as they drink the hot water. Soft hiss.",
    "p5",
    ["c2"],
  ],
  [
    "STEP",
    "AHA",
    6,
    "Coarse? **Simmer it.**",
    "Coarse bulgur needs simmering with a lid on.",
    "Coarse bulgur simmering in a dark enamel pot, its lid beside it.",
    "Static camera. Bubbles rise and burst around the coarse bulgur in the pot. Sound of a gentle simmer.",
    "p2",
    ["c3"],
  ],
  [
    "STEP",
    "USEFULNESS",
    6,
    "Toast the **dry grains.**",
    "Toast them first for a nutty taste.",
    "Dry bulgur grains in a black cast-iron pan, a wooden spoon in them.",
    "Static camera. A wooden spoon tosses the dry grains in the pan. Soft rattle of grains.",
    "p3",
    ["c4"],
  ],
  [
    "PEAK",
    "APPETITE",
    6,
    "Nutty. **Toasty.**",
    "Toasted dry grains taste nutty.",
    "Golden toasted bulgur grains in a black cast-iron pan.",
    "Static camera. The golden grains sizzle and jump in the hot pan. Crisp sizzling sound.",
    "p6",
    ["c4"],
  ],
  [
    "PAYOFF",
    "SAVE_IT",
    7,
    "Fine or coarse? **Check the bulgur.**",
    "Fine: hot water. Coarse: simmer with a lid. Follow for more grain rules.",
    "Fluffy cooked bulgur in a black stoneware bowl, a fork resting in it.",
    "Static camera. Light steam drifts up from the fluffy bulgur in the bowl. Quiet kitchen ambience.",
    "p4",
    ["c2", "c3"],
  ],
]);

const PASTA_OUTPUT_V4 = v4Of(PASTA_OUTPUT_V2, [
  [
    "HOOK",
    "DOUBT",
    7,
    "The **worst** pasta advice",
    "",
    "A dark enamel pot of boiling water with drops of oil floating on top.",
    "Static camera. Oil drops swirl and float on the boiling water as bubbles burst. Sound of a rolling boil.",
    "p1",
    [],
  ],
  [
    "RULE",
    "SURPRISE",
    6,
    "Oil floats. **It does nothing.**",
    "It stays on top and does not stop pasta from sticking.",
    "Close-up of oil drops floating on boiling water in a dark enamel pot.",
    "Static camera. The oil drops drift and spin on the bubbling surface. Sound of boiling water.",
    "p6",
    ["c2"],
  ],
  [
    "STEP",
    "AHA",
    6,
    "**Stir** in minute one.",
    "Stir in the first minute so it does not stick.",
    "Spaghetti in a dark enamel pot of boiling water, a wooden spoon in it.",
    "Static camera. A wooden spoon stirs the spaghetti round in the boiling water. Sound of stirring and bubbling.",
    "p2",
    ["c3"],
  ],
  [
    "STEP",
    "USEFULNESS",
    6,
    "Salt it **well.**",
    "Salt seasons the pasta from the inside.",
    "A small dark bowl of coarse salt tilted over a dark enamel pot of boiling water.",
    "Static camera. Coarse salt pours from the small bowl into the boiling water. Sound of salt hitting water.",
    "p3",
    ["c4"],
  ],
  [
    "PEAK",
    "USEFULNESS",
    6,
    "Save the **starchy water.**",
    "A cup of it goes into the sauce.",
    "A glass cup above a dark enamel pot of cloudy pasta water.",
    "Static camera. The glass cup dips into the pot and lifts out cloudy pasta water. Sound of water sloshing.",
    "p4",
    ["c5"],
  ],
  [
    "PAYOFF",
    "SAVE_IT",
    7,
    "No oil. **Stir the pasta.**",
    "Stir early, salt well. Send this to whoever still pours oil in the pot.",
    "Glossy spaghetti with sauce on a charcoal stoneware plate.",
    "Static camera. Light steam drifts up from the glossy spaghetti on the plate. Quiet kitchen ambience.",
    "p5",
    ["c2", "c3"],
  ],
]);

const CHOCOLATE_OUTPUT_V4 = v4Of(CHOCOLATE_OUTPUT_V2, [
  [
    "HOOK",
    "DOUBT",
    7,
    "One drop of **water?**",
    "",
    "A spoon above a white bowl of melted dark chocolate, a thick ribbon of chocolate falling from it.",
    "Static camera. A thick ribbon of melted chocolate falls from the spoon into the bowl. Soft pouring sound.",
    "p6",
    [],
  ],
  [
    "RULE",
    "INTRIGUE",
    6,
    "It makes chocolate **seize.**",
    "A little water turns it into a grainy paste.",
    "A white bowl of glossy melted dark chocolate, a drop of water just above it.",
    "Static camera. A single drop of water falls into the melted chocolate. Soft drip sound.",
    "p2",
    ["c2"],
  ],
  [
    "STEP",
    "AHA",
    6,
    "Dry bowl. **Dry spoon.**",
    "Keep the bowl and the spoon completely dry.",
    "A dry white bowl with a dry spoon and dark chocolate pieces in it.",
    "Static camera. Dark chocolate pieces tumble into the dry bowl. Sound of pieces clinking.",
    "p3",
    ["c3"],
  ],
  [
    "STEP",
    "USEFULNESS",
    6,
    "Barely simmering. **Never boiling.**",
    "Melt it over barely simmering water.",
    "A white bowl of dark chocolate pieces over a pot of barely simmering water.",
    "Static camera. Small bubbles rise in the pot under the bowl of chocolate. Soft simmer sound.",
    "p4",
    ["c4"],
  ],
  [
    "PEAK",
    "APPETITE",
    6,
    "Stir until **glossy.**",
    "Slowly, until it is smooth and glossy.",
    "A white bowl of half-melted dark chocolate, a spatula in it.",
    "Static camera. A spatula stirs the melted chocolate slowly; it turns smooth and glossy. Soft stirring sound.",
    "p5",
    ["c5"],
  ],
  [
    "PAYOFF",
    "SAVE_IT",
    7,
    "Keep the **water** out.",
    "Dry tools, gentle heat, slow stirring. Send this to whoever melts chocolate.",
    "Glossy melted chocolate over a strawberry on a white plate.",
    "Static camera. Glossy chocolate slowly drips down the strawberry onto the plate. Soft drip sound.",
    "p7",
    ["c3", "c4", "c5"],
  ],
]);

/** A post of reel-director@4's eval: v2's input and a v4 answer. */
export type ReelPostV4 = { key: string; input: ReelDirectorInputV2; output: ReelDirectorOutputV4 };

/** The four posts answered in the v4 format (same keys and inputs as REEL_EVAL_POSTS). */
export const REEL_POSTS_V4: readonly ReelPostV4[] = [
  { key: "risotto-rice", input: RISOTTO_INPUT_V2, output: RISOTTO_OUTPUT_V4 },
  { key: "bulgur-hot-water", input: BULGUR_INPUT_V2, output: BULGUR_OUTPUT_V4 },
  { key: "pasta-oil", input: PASTA_INPUT_V2, output: PASTA_OUTPUT_V4 },
  { key: "chocolate-drop", input: CHOCOLATE_INPUT_V2, output: CHOCOLATE_OUTPUT_V4 },
];

/** reel-director@4's fixture. */
export const FIXTURE_OUTPUT_V4: ReelDirectorOutputV4 = RISOTTO_OUTPUT_V4;

import type {
  AttributionEventRow,
  AttributionImportEntry,
  Commercial,
  ContentLearning,
  Engagement,
  Growth,
  Lineage,
  Operations,
  RankedPost,
  UnknownCampaign,
} from "@rc/modules/analytics";

// Synthetic dashboard data: for the component tests and for /dev/analytics (a page that shows the
// four tabs without a database). Nothing here is a real number.

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);

export const growthFixture = (): Growth => {
  const days = Array.from({ length: 28 }, (_, i) => i);
  return {
    tiles: {
      followers: 1432,
      followerGrowth: 96,
      avgDailyReach: 2860,
      nonFollowerShare: 0.62,
      days: 28,
    },
    followersSeries: days.map((i) => ({
      date: day(i),
      value: 1336 + Math.round(i * 3.6 + (i % 5)),
    })),
    reachSeries: days.map((i) => ({
      date: day(i),
      value: i === 9 || i === 10 ? null : 1800 + Math.round(900 * Math.sin(i / 3) ** 2) + i * 45,
    })),
    nonFollowerShareSeries: days.map((i) => ({
      date: day(i),
      value: i === 9 || i === 10 ? null : 0.45 + 0.02 * Math.sin(i / 4) + i * 0.006,
    })),
  };
};

const POSTS = [
  ["¿Lavas el arroz del risotto?", "MYTH_BUST", 0.071, 0.021, "CAROUSEL"],
  ["Hot water on bulgur?", "DIRECT_QUESTION", 0.052, 0.034, "REEL"],
  ["Tres errores con la pasta", "MISTAKE_CALLOUT", 0.043, 0.012, "CAROUSEL"],
  ["Why is your rice sticky?", "CURIOSITY_GAP", 0.031, 0.009, "CAROUSEL"],
  ["Aceite en el agua de la pasta", "MYTH_BUST", 0.012, 0.004, "CAROUSEL"],
] as const;

export const engagementFixture = (): Engagement => ({
  tiles: {
    posts: 6,
    withRates: 5,
    exactD7: 4,
    medianSaveRate: 0.043,
    medianShareRate: 0.012,
    medianCommentRate: 0.004,
    medianEngagementRate: 0.081,
    medianReach: 3150,
  },
  posts: [
    ...POSTS.map(([hook, hookType, save, share, format], i) => ({
      publicationId: `00000000-0000-4000-8000-00000000000${i + 1}`,
      variantId: `10000000-0000-4000-8000-00000000000${i + 1}`,
      ideaId: `20000000-0000-4000-8000-00000000000${i + 1}`,
      publishedAt: new Date(Date.UTC(2026, 9, 20 - i * 3, 9)),
      marketCode: i % 2 === 0 ? "es-ES" : "en",
      format,
      hook,
      hookType,
      permalink: null,
      metrics: {
        slot: i === 3 ? "D3" : "D7",
        ageHours: i === 3 ? 75 : 168,
        isExactD7: i !== 3,
        reach: 4200 - i * 600,
        saves: 100,
        shares: 20,
        comments: 5,
        saveRate: save,
        shareRate: share,
        commentRate: 0.004,
        engagementRate: 0.09 - i * 0.01,
      },
    })),
    {
      publicationId: "00000000-0000-4000-8000-000000000009",
      variantId: "10000000-0000-4000-8000-000000000009",
      ideaId: "20000000-0000-4000-8000-000000000009",
      publishedAt: new Date(Date.UTC(2026, 9, 24, 9)),
      marketCode: "en",
      format: "CAROUSEL",
      hook: "Fresh post, no numbers yet",
      hookType: "QUESTION",
      permalink: null,
      metrics: null,
    },
  ],
});

export const learningFixture = (): ContentLearning => ({
  dimension: "hook_type",
  minSample: 3,
  market: { n: 14, medianSaveRate: 0.038, medianShareRate: 0.011, medianReach: 3100 },
  rows: [
    {
      value: "MYTH_BUST",
      n: 5,
      medianSaveRate: 0.061,
      medianShareRate: 0.018,
      medianReach: 3800,
      liftVsMarket: 1.61,
      lowSample: false,
    },
    {
      value: "DIRECT_QUESTION",
      n: 4,
      medianSaveRate: 0.044,
      medianShareRate: 0.014,
      medianReach: 3300,
      liftVsMarket: 1.16,
      lowSample: false,
    },
    {
      value: "MISTAKE_CALLOUT",
      n: 3,
      medianSaveRate: 0.036,
      medianShareRate: 0.01,
      medianReach: 2900,
      liftVsMarket: 0.95,
      lowSample: false,
    },
    {
      value: "CURIOSITY_GAP",
      n: 2,
      medianSaveRate: 0.021,
      medianShareRate: 0.006,
      medianReach: 2500,
      liftVsMarket: 0.55,
      lowSample: true,
    },
    {
      value: "NONE",
      n: 1,
      medianSaveRate: 0.012,
      medianShareRate: 0.002,
      medianReach: 1800,
      liftVsMarket: 0.32,
      lowSample: true,
    },
  ],
});

const ranked = (i: number, value: number, format = "CAROUSEL"): RankedPost => ({
  publicationId: `00000000-0000-4000-8000-0000000001${i}0`,
  ideaId: `20000000-0000-4000-8000-0000000001${i}0`,
  marketCode: "es-ES",
  format,
  hook: POSTS[i % POSTS.length]?.[0] ?? null,
  hookType: POSTS[i % POSTS.length]?.[1] ?? null,
  publishedAt: new Date(Date.UTC(2026, 9, 18 - i * 2, 9)),
  permalink: null,
  value,
  reach: 3000,
  thumbnailUrl: null,
});

export const rankedFixture = () => ({
  top: [ranked(0, 0.071), ranked(1, 0.052, "REEL"), ranked(2, 0.043)],
  bottom: [ranked(4, 0.012), ranked(3, 0.031)],
  considered: 14,
});

export const operationsFixture = (): Operations => ({
  generated: 18,
  approved: 11,
  rejected: 4,
  approvalRate: 11 / 15,
  rejectionReasons: [
    { code: "WEAK_HOOK", count: 2 },
    { code: "TRANSLATIONESE", count: 1 },
    { code: "VISUAL_ISSUE", count: 1 },
  ],
  avgEditsPerApproved: 2.4,
  medianTimeToApproveHours: 5.5,
  criticPassRate: 0.64,
  criticReports: 14,
  regenerationsPerVariant: 0.39,
  costPerApprovedPost: 1.87,
});

const snap = (slot: string, ageHours: number, reach: number, saves: number, at: string) => ({
  slot,
  measuredAt: new Date(at),
  ageHours,
  reach,
  views: Math.round(reach * 1.4),
  likes: Math.round(reach * 0.08),
  comments: Math.round(reach * 0.004),
  saves,
  shares: Math.round(saves / 4),
  totalInteractions: Math.round(reach * 0.12),
  saveRate: saves / reach,
  shareRate: saves / 4 / reach,
});

export const lineageFixture = (): Lineage => ({
  publication: {
    id: "00000000-0000-4000-8000-000000000001",
    status: "PUBLISHED",
    publishedAt: new Date("2026-10-10T09:00:00Z"),
    permalink: "https://www.instagram.com/p/EXAMPLE/",
    instagramMediaId: "17900000000000001",
    followerCountAtPublish: 1380,
    accountUsername: "kitchen_es",
  },
  market: { id: "m1", code: "es-ES", name: "Spain", flagEmoji: "🇪🇸", timeZone: "Europe/Madrid" },
  variant: {
    id: "10000000-0000-4000-8000-000000000001",
    format: "CAROUSEL",
    status: "PUBLISHED",
    hook: "¿Lavas el arroz del risotto? Ese es el error",
    hookType: "MISTAKE_CALLOUT",
    visualStyle: "EDITORIAL_MACRO",
    ctaType: "SAVE",
    templateSequence: ["A", "B", "F"],
    campaignId: null,
    offerName: null,
    generationVersion: "p1.7.0",
    sourceVariantId: null,
    reels: [],
  },
  idea: {
    id: "20000000-0000-4000-8000-000000000001",
    topic: "Risotto rice is not rinsed",
    category: "GRAINS_RICE_PASTA",
    angle: "COMMON_MISTAKE",
    coreMessage: "The surface starch is what makes risotto creamy: rinsing takes it away.",
    evidenceSummary: "Two approved cards state the claim and the toasting step.",
    commercialIntent: "NONE",
  },
  cards: [
    {
      id: "c1",
      version: 2,
      role: "PRIMARY",
      title: "Do not rinse risotto rice",
      claim: "The surface starch makes the risotto creamy, so the rice is not rinsed.",
      sourceTitle: "Synthetic source: rice chapter",
      sourcePage: 41,
      quote: "Arborio is never rinsed: the starch is the point.",
    },
    {
      id: "c2",
      version: 1,
      role: "SUPPORTING",
      title: "Toast the rice dry first",
      claim: "Two minutes of dry toasting before the stock keeps the grains separate.",
      sourceTitle: "Synthetic source: rice chapter",
      sourcePage: 42,
      quote: null,
    },
  ],
  brief: {
    audienceFraming: "Spanish home cooks who rinse rice by habit.",
    tone: "Warm, direct, no lecture.",
    hookType: "MISTAKE_CALLOUT",
    risks: ["Risotto is an Italian dish: avoid claiming it is Spanish"],
    culturalHooks: ["Arroz del domingo"],
    differentiationNotes: "Mistake first, myth second.",
  },
  version: {
    id: "v1",
    versionNo: 2,
    approvedAt: new Date("2026-10-09T15:30:00Z"),
    approvedBy: "Sergey",
    caption: "Lavas el arroz del risotto. Ese es el error.\n\nGuárdalo para la próxima vez.",
    cta: { type: "SAVE", text: "Guárdalo" },
    hashtags: ["#arroz", "#cocina"],
    slideCount: 6,
    slideUrls: [],
    videoUrl: null,
    disclosure: "CAPTION_NOTE",
  },
  reviewHistory: [
    {
      action: "EDIT",
      at: new Date("2026-10-09T10:00:00Z"),
      reviewer: "Sergey",
      reasonCode: null,
      reason: null,
      field: "slides.2.slots.body",
    },
    {
      action: "REGENERATE",
      at: new Date("2026-10-09T10:20:00Z"),
      reviewer: "Sergey",
      reasonCode: null,
      reason: null,
      field: "hook",
    },
    {
      action: "APPROVE",
      at: new Date("2026-10-09T15:30:00Z"),
      reviewer: "Sergey",
      reasonCode: null,
      reason: null,
      field: null,
    },
  ],
  generation: {
    runs: 7,
    costUsd: 0.71,
    byStage: [
      { stage: "CONTENT_WRITING", runs: 2, costUsd: 0.4 },
      { stage: "CRITIC", runs: 3, costUsd: 0.2 },
    ],
  },
  metrics: {
    d7: {
      ...snap("D7", 168, 2400, 168, "2026-10-17T09:30:00Z"),
      isExactD7: true,
      engagementRate: 0.118,
      commentRate: 0.004,
    },
    timeline: [
      snap("H2", 2.1, 160, 6, "2026-10-10T11:06:00Z"),
      snap("D1", 24.4, 1100, 58, "2026-10-11T09:26:00Z"),
      snap("D3", 72.3, 1900, 120, "2026-10-13T09:20:00Z"),
      snap("D7", 168, 2400, 168, "2026-10-17T09:30:00Z"),
    ],
  },
});

/** The Commercial tab: the numbers of the module test of `getCommercial` (M6-08). */
export const commercialFixture = (): Commercial => ({
  totals: {
    leads: 7,
    sales: 4,
    refunds: 1,
    revenue: [
      { currency: "EUR", amount: 60 },
      { currency: "USD", amount: 25 },
    ],
    reachD7: 2500,
    revenuePer1kReach: [
      { currency: "EUR", amount: 20 },
      { currency: "USD", amount: 10 },
    ],
  },
  campaigns: [
    {
      campaignId: "rc-es-261001-aaa111",
      marketCode: "es-ES",
      offerName: "Guía del arroz",
      known: true,
      publicationId: "00000000-0000-4000-8000-0000000000a1",
      hook: "El error que arruina tu risotto",
      leads: 4,
      sales: 2,
      refunds: 1,
      revenue: [{ currency: "EUR", amount: 50 }],
      reachD7: 2000,
      revenuePer1kReach: [{ currency: "EUR", amount: 25 }],
    },
    {
      campaignId: "rc-en-261001-ccc333",
      marketCode: "en",
      offerName: "Rice guide",
      known: true,
      publicationId: "00000000-0000-4000-8000-0000000000a2",
      hook: "Stop rinsing risotto rice",
      leads: 1,
      sales: 1,
      refunds: 0,
      revenue: [{ currency: "USD", amount: 25 }],
      reachD7: 500,
      revenuePer1kReach: [{ currency: "USD", amount: 50 }],
    },
    {
      campaignId: "rc-es-261001-bbb222",
      marketCode: "es-ES",
      offerName: "Guía del arroz",
      known: true,
      publicationId: null,
      hook: "Arroz que no se pega",
      leads: 0,
      sales: 1,
      refunds: 0,
      revenue: [{ currency: "EUR", amount: 10 }],
      reachD7: null,
      revenuePer1kReach: null,
    },
    {
      campaignId: null,
      marketCode: "es-ES",
      offerName: null,
      known: false,
      publicationId: null,
      hook: null,
      leads: 2,
      sales: 0,
      refunds: 0,
      revenue: [],
      reachD7: null,
      revenuePer1kReach: null,
    },
  ],
  offers: [
    {
      offerId: "00000000-0000-4000-8000-0000000000b1",
      offerName: "Guía del arroz",
      leads: 4,
      sales: 3,
      refunds: 1,
      revenue: [{ currency: "EUR", amount: 60 }],
    },
    {
      offerId: "00000000-0000-4000-8000-0000000000b2",
      offerName: "Rice guide",
      leads: 1,
      sales: 1,
      refunds: 0,
      revenue: [{ currency: "USD", amount: 25 }],
    },
  ],
  markets: [
    {
      marketCode: "en",
      leads: 1,
      sales: 1,
      refunds: 0,
      revenue: [{ currency: "USD", amount: 25 }],
    },
    {
      marketCode: "es-ES",
      leads: 6,
      sales: 3,
      refunds: 1,
      revenue: [{ currency: "EUR", amount: 60 }],
    },
  ],
});

export const unknownCampaignsFixture = (): UnknownCampaign[] => [
  {
    campaignId: "rc-en-261001-typo00",
    marketCode: "en",
    events: 2,
    leads: 2,
    sales: 1,
    firstAt: new Date("2026-10-05T12:00:00Z"),
    lastAt: new Date("2026-10-06T12:00:00Z"),
  },
];

export const attributionEventsFixture = (): AttributionEventRow[] => [
  {
    id: "00000000-0000-4000-8000-0000000000c1",
    type: "SALE",
    occurredAt: new Date("2026-10-06T00:00:00Z"),
    campaignId: "rc-en-261001-ccc333",
    marketCode: "en",
    quantity: 1,
    amount: 25,
    currency: "USD",
    source: "CSV_IMPORT",
  },
  {
    id: "00000000-0000-4000-8000-0000000000c2",
    type: "LEAD",
    occurredAt: new Date("2026-10-03T00:00:00Z"),
    campaignId: "rc-es-261001-aaa111",
    marketCode: "es-ES",
    quantity: 4,
    amount: null,
    currency: null,
    source: "MANUAL",
  },
];

export const attributionImportsFixture = (): AttributionImportEntry[] => [
  {
    batchId: "00000000-0000-4000-8000-0000000000d1",
    fileName: "orders-october.csv",
    requestedAt: new Date("2026-10-08T09:00:00Z"),
    report: {
      batchId: "00000000-0000-4000-8000-0000000000d1",
      totalRows: 9,
      created: 7,
      duplicates: 1,
      unknownCampaigns: 0,
      errorCount: 1,
      errors: [{ row: 10, field: "market", message: "Unknown market." }],
    },
  },
  {
    batchId: "00000000-0000-4000-8000-0000000000d2",
    fileName: "orders-late.csv",
    requestedAt: new Date("2026-10-09T09:00:00Z"),
    report: null,
  },
];

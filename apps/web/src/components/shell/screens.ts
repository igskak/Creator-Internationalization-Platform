// Screen catalog (plan 10 §10.1–10.2): one source for the sidebar and the placeholder pages.
// `task` is the task that builds the real screen.
import { en, type Messages } from "../../lib/i18n/en";

export type Screen = { route: string; title: string; purpose: string; task: string; p1?: boolean };

export const SCREENS = {
  dashboard: {
    route: "/dashboard",
    title: "Dashboard",
    purpose: "Work queue and system health.",
    task: "M0-17 → H-01",
  },
  ideas: {
    route: "/content/ideas",
    title: "Ideas",
    purpose: "Proposed, accepted, rejected and archived Master Ideas.",
    task: "M2-08",
  },
  idea: {
    route: "/content/ideas/[id]",
    title: "Idea",
    purpose: "Core message, angle, linked knowledge cards and rationale.",
    task: "M2-08",
  },
  drafts: {
    route: "/content/drafts",
    title: "Drafts",
    purpose: "Market variants waiting for review.",
    task: "M4-07",
  },
  review: {
    route: "/content/review/[ideaId]",
    title: "Review",
    purpose: "All market variants of one idea side by side.",
    task: "M2-15 → M4-05",
  },
  calendar: {
    route: "/content/calendar",
    title: "Calendar",
    purpose: "Scheduled posts by day and market.",
    task: "M4-09",
  },
  published: {
    route: "/content/published",
    title: "Published",
    purpose: "Published posts with metrics.",
    task: "M6-09",
  },
  lineage: {
    route: "/content/published/[publicationId]",
    title: "Lineage",
    purpose: "Source → cards → idea → version → publication → metrics.",
    task: "M6-09",
  },
  sources: {
    route: "/knowledge/sources",
    title: "Sources",
    purpose: "Source library with rights and processing status.",
    task: "M1-04",
  },
  source: {
    route: "/knowledge/sources/[id]",
    title: "Source",
    purpose: "Metadata, rights, pages, batches and cards of one source.",
    task: "M1-04",
  },
  cards: {
    route: "/knowledge/cards",
    title: "Knowledge Base",
    purpose: "Knowledge cards with review status.",
    task: "M1-17",
  },
  card: {
    route: "/knowledge/cards/[id]",
    title: "Knowledge card",
    purpose: "Card editor with the cited source evidence.",
    task: "M1-18",
  },
  offers: {
    route: "/knowledge/offers",
    title: "Products & offers",
    purpose: "Products and market offers.",
    task: "M2-02",
  },
  posts: {
    route: "/knowledge/posts",
    title: "Historical posts",
    purpose: "Imported posts with metrics and annotations.",
    task: "M1-22",
    p1: true,
  },
  market: {
    route: "/markets/[marketCode]",
    title: "Market profile",
    purpose: "Tone, food culture, vocabulary, forbidden patterns, units and time zone.",
    task: "M0-18",
  },
  analytics: {
    route: "/analytics",
    title: "Analytics",
    purpose: "Growth, engagement, content learning and operations dashboards.",
    task: "M6-05",
  },
  experiments: {
    route: "/experiments",
    title: "Experiments",
    purpose: "Experiments-lite: arms and results.",
    task: "M7-06",
    p1: true,
  },
  instagram: {
    route: "/settings/instagram",
    title: "Instagram",
    purpose: "Connected accounts per market, token status and quota.",
    task: "M5-03",
  },
  brand: {
    route: "/settings/brand",
    title: "Brand",
    purpose: "Voice guide, visual system and taxonomy.",
    task: "M0-18",
  },
  ai: {
    route: "/settings/ai",
    title: "AI / Providers",
    purpose: "Prompt versions, models and cost by stage.",
    task: "H-05",
    p1: true,
  },
  health: {
    route: "/settings/health",
    title: "Health",
    purpose: "System health indicators and the publishing kill switch.",
    task: "H-01",
  },
} satisfies Record<string, Screen>;

export type ScreenKey = keyof typeof SCREENS;

export type NavItem = {
  label: string;
  href: string;
  /** Emoji shown before the label (market flags). */
  icon?: string;
  screen?: ScreenKey;
  disabled?: boolean;
  note?: string;
};
export type NavSection = { label: string; href?: string; items: NavItem[] };

export type NavMarket = {
  code: string;
  displayName: string;
  flagEmoji: string | null;
  isActive: boolean;
};

/** Names of the sidebar sections and screens in the interface language (`messages.nav`). */
export type NavLabels = Messages["nav"] & { later: string };
const ENGLISH_LABELS: NavLabels = { ...en.nav, later: en.shell.later };

/** Sidebar (10 §10.1). Markets come from the database; inactive ones are shown disabled. */
export function buildNav(markets: NavMarket[], labels: NavLabels = ENGLISH_LABELS): NavSection[] {
  const item = (key: ScreenKey): NavItem => ({
    label:
      key in labels.screens
        ? labels.screens[key as keyof NavLabels["screens"]]
        : SCREENS[key].title,
    href: SCREENS[key].route,
    screen: key,
    ...("p1" in SCREENS[key] ? { note: "P1" } : {}),
  });
  const { sections } = labels;
  return [
    { label: sections.dashboard, href: SCREENS.dashboard.route, items: [] },
    {
      label: sections.content,
      items: [item("ideas"), item("drafts"), item("calendar"), item("published")],
    },
    {
      label: sections.knowledge,
      items: [item("sources"), item("cards"), item("offers"), item("posts")],
    },
    {
      label: sections.markets,
      items: markets.map((m) => ({
        label: m.displayName,
        ...(m.flagEmoji ? { icon: m.flagEmoji } : {}),
        href: `/markets/${encodeURIComponent(m.code)}`,
        screen: "market" as const,
        ...(m.isActive ? {} : { disabled: true, note: labels.later }),
      })),
    },
    { label: sections.analytics, href: SCREENS.analytics.route, items: [] },
    { label: sections.experiments, href: SCREENS.experiments.route, items: [] },
    {
      label: sections.settings,
      items: [item("instagram"), item("brand"), item("ai"), item("health")],
    },
  ];
}

/** True if `href` is the current page or a parent of it (e.g. /content/ideas for /content/ideas/1). */
export function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

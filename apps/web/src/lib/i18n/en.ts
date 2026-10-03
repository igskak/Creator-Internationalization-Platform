import type { PluralForms } from "./format";

// English messages. `ru.ts` must have exactly the same keys: its type is derived from this object.

export const en = {
  shell: {
    appName: "RegChef Content Engine",
    userMenu: "User menu",
    role: "Role: {role}",
    signOut: "Sign out",
    language: "Language",
    mainNav: "Main",
    later: "later",
  },
  nav: {
    sections: {
      dashboard: "Dashboard",
      content: "Content",
      knowledge: "Knowledge",
      markets: "Markets",
      analytics: "Analytics",
      experiments: "Experiments",
      settings: "Settings",
    },
    screens: {
      dashboard: "Dashboard",
      ideas: "Ideas",
      drafts: "Drafts",
      calendar: "Calendar",
      published: "Published",
      sources: "Sources",
      cards: "Knowledge Base",
      offers: "Products/Offers",
      posts: "Historical posts",
      analytics: "Analytics",
      experiments: "Experiments",
      instagram: "Instagram",
      brand: "Brand",
      ai: "AI / Providers",
      health: "Health",
    },
  },
  cards: {
    title: "Knowledge Base",
    subtitle: "Cards extracted from your sources. Review them, then approve or archive.",
    tabs: {
      NEEDS_REVIEW: "Needs review",
      CHEF_APPROVED: "Approved",
      ARCHIVED: "Archived",
      EXTRACTED: "Processing",
      all: "All",
    },
    columns: { card: "Card", check: "Quote" },
    searchPlaceholder: "Search cards",
    searchLabel: "Search cards",
    filters: {
      category: "Category",
      flags: "Flags",
      source: "Source",
      language: "Language",
      clear: "Clear filters",
      none: "Nothing to filter by",
    },
    flags: {
      QUOTE_UNVERIFIED: "Quote not found",
      LOW_CONFIDENCE: "Low confidence",
      DUPLICATE_SUSPECTED: "Possible duplicate",
      SAFETY_SENSITIVE: "Safety",
    },
    flagHints: {
      QUOTE_UNVERIFIED:
        "The quote was not found in the cited pages. Check the source before approving.",
      LOW_CONFIDENCE: "A number was not found in the source, or the model was unsure.",
      DUPLICATE_SUSPECTED: "Very similar to an older card.",
      SAFETY_SENSITIVE: "Food-safety topic. Read it carefully before approving.",
    },
    quote: {
      verified: "Quote found in the source",
      unverified: "Quote not found in the source",
      manual: "Added by hand, no source quote",
    },
    confidence: "Model confidence {value}",
    order: "Order: verified quote first, then confidence",
    selectAll: "Select all cards on this page",
    selectRow: "Select {title}",
    openCard: "Open card",
    sourcePage: "{source}, p. {page}",
    bulk: {
      selected: {
        one: "{count} card selected",
        other: "{count} cards selected",
      } as PluralForms,
      approve: "Approve",
      archive: "Archive",
      clear: "Clear selection",
      approveVerified: "Approve verified ({count})",
      approveVerifiedHint:
        "Cards with a verified quote and no flags, up to {batch} at a time. Cards with flags need a closer look.",
      onlyChef: "Only the chef or the owner can approve cards.",
    },
    archiveDialog: {
      title: { one: "Archive {count} card", other: "Archive {count} cards" } as PluralForms,
      description:
        "Archived cards stay in the database but are not used for new ideas. You can restore them later.",
      reason: "Reason",
      reasons: {
        INACCURATE: "Inaccurate",
        DUPLICATE: "Duplicate",
        OUT_OF_SCOPE: "Out of scope",
        OTHER: "Other",
      },
      confirm: "Archive",
      cancel: "Cancel",
    },
    result: {
      approved: {
        one: "Approved {count} card",
        other: "Approved {count} cards",
      } as PluralForms,
      archived: {
        one: "Archived {count} card",
        other: "Archived {count} cards",
      } as PluralForms,
      skipped: {
        one: "{count} card skipped",
        other: "{count} cards skipped",
      } as PluralForms,
      reasons: {
        QUOTE_UNVERIFIED: "quote not verified",
        HAS_FLAGS: "has flags",
        INVALID_STATE: "not in the right status",
        NOT_FOUND: "not found",
        MISSING_FIELDS: "missing title, claim or category",
      },
    },
    empty: {
      noneTitle: "No knowledge cards yet",
      noneBody: "Upload a source and its cards will show up here for review.",
      noneAction: "Go to Sources",
      filteredTitle: "No cards match",
      filteredBody: "Try other filters or a different search.",
      reviewDoneTitle: "Nothing left to review",
      reviewDoneBody: "Every card is approved or archived.",
      clear: "Clear filters",
    },
    pagination: {
      range: "{from}–{to} of {total}",
      previous: "Previous",
      next: "Next",
      label: "Pages",
    },
  },
};

export type Messages = typeof en;

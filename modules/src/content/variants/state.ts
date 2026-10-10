import type { schema } from "@rc/db";
import { BLOCKING_VARIANT_FLAGS } from "@rc/db/json";
import { InvalidStateError } from "@rc/lib/errors";
import type { UserRole } from "../../core";

// The content variant state machine (plan 10 §10.4.3, single source: the UI reads "allowed
// actions" from here). Pure: no database. `transitionVariant` (./transition) applies a row.

export type VariantStatus = (typeof schema.contentVariants.$inferSelect)["status"];

export const VARIANT_EVENTS = [
  "START_PIPELINE",
  "PIPELINE_SUCCESS",
  "PIPELINE_FAILURE",
  /** Edit or regenerate a field: any content change. */
  "EDIT",
  "REQUEST_CHANGES",
  "RESUBMIT",
  "APPROVE",
  "REJECT",
  "UNAPPROVE",
  "SCHEDULE",
  "PUBLISH_NOW",
  "CANCEL_SCHEDULE",
  "DISPATCH",
  "PUBLISH_SUCCESS",
  "PUBLISH_FAILURE",
  /** FAILED → PUBLISHING. */
  "RETRY",
  /** FAILED → SCHEDULED with a new time. */
  "RETRY_SCHEDULED",
] as const;
export type VariantEvent = (typeof VARIANT_EVENTS)[number];

/** What a transition has to check before it runs (done by the service that owns the event). */
export type Guard =
  | "LOCK_VERSION"
  | "REASON"
  | "REASON_CODE"
  | "RENDER_CURRENT"
  | "NO_BLOCKING_FLAGS"
  | "CHECKLIST"
  | "OFFER_IF_COMMERCIAL"
  | "TIME_AT_LEAST_5_MIN"
  | "ACCOUNT_READY"
  | "CONFIRM";

/** What happens next to the row's neighbours; `transitionVariant` runs the ones it can. */
export type SideEffect =
  | "REVIEW_EVENT"
  | "RE_RENDER"
  | "SNAPSHOT"
  | "CAMPAIGN_ID"
  | "CANCEL_PUBLICATION"
  | "CREATE_PUBLICATION"
  | "CLEAR_APPROVAL";

export type TransitionRow = {
  /** Row number of the table in plan 10 §10.4.3. */
  n: number;
  from: readonly VariantStatus[];
  event: VariantEvent;
  to: VariantStatus;
  guards: readonly Guard[];
  effects: readonly SideEffect[];
  /** Audit action; every transition writes one. */
  audit: string;
};

const IN_REVIEW = ["READY_FOR_REVIEW", "CHANGES_REQUESTED"] as const;
const APPROVED_STATES = ["APPROVED", "SCHEDULED", "FAILED"] as const;

export const VARIANT_TRANSITIONS: readonly TransitionRow[] = [
  // 1 (creation of a DRAFT by generateVariants) is not a transition.
  {
    n: 2,
    from: ["DRAFT", ...IN_REVIEW],
    event: "START_PIPELINE",
    to: "GENERATING",
    guards: [],
    effects: [],
    audit: "variant.generation_started",
  },
  {
    n: 3,
    from: ["GENERATING"],
    event: "PIPELINE_SUCCESS",
    to: "READY_FOR_REVIEW",
    guards: [],
    effects: ["RE_RENDER"],
    audit: "variant.generated",
  },
  {
    n: 4,
    from: ["GENERATING"],
    event: "PIPELINE_FAILURE",
    to: "DRAFT",
    guards: [],
    effects: [],
    audit: "variant.generation_failed",
  },
  {
    n: 5,
    from: ["READY_FOR_REVIEW"],
    event: "EDIT",
    to: "READY_FOR_REVIEW",
    guards: ["LOCK_VERSION"],
    effects: ["REVIEW_EVENT", "RE_RENDER"],
    audit: "variant.edited",
  },
  {
    n: 6,
    from: ["READY_FOR_REVIEW"],
    event: "REQUEST_CHANGES",
    to: "CHANGES_REQUESTED",
    guards: ["REASON_CODE", "REASON"],
    effects: ["REVIEW_EVENT"],
    audit: "variant.changes_requested",
  },
  {
    n: 7,
    from: ["CHANGES_REQUESTED"],
    event: "EDIT",
    to: "CHANGES_REQUESTED",
    guards: ["LOCK_VERSION"],
    effects: ["REVIEW_EVENT", "RE_RENDER"],
    audit: "variant.edited",
  },
  {
    n: 8,
    from: ["CHANGES_REQUESTED"],
    event: "RESUBMIT",
    to: "READY_FOR_REVIEW",
    guards: [],
    effects: ["REVIEW_EVENT"],
    audit: "variant.resubmitted",
  },
  {
    n: 9,
    from: ["READY_FOR_REVIEW"],
    event: "APPROVE",
    to: "APPROVED",
    guards: [
      "LOCK_VERSION",
      "RENDER_CURRENT",
      "NO_BLOCKING_FLAGS",
      "CHECKLIST",
      "OFFER_IF_COMMERCIAL",
    ],
    effects: ["SNAPSHOT", "CAMPAIGN_ID", "REVIEW_EVENT"],
    audit: "variant.approved",
  },
  {
    n: 10,
    from: IN_REVIEW,
    event: "REJECT",
    to: "REJECTED",
    guards: ["REASON_CODE"],
    effects: ["REVIEW_EVENT"],
    audit: "variant.rejected",
  },
  {
    n: 11,
    from: ["APPROVED"],
    event: "SCHEDULE",
    to: "SCHEDULED",
    guards: ["TIME_AT_LEAST_5_MIN"],
    effects: ["CREATE_PUBLICATION"],
    audit: "variant.scheduled",
  },
  {
    n: 12,
    from: ["APPROVED"],
    event: "PUBLISH_NOW",
    to: "PUBLISHING",
    guards: ["ACCOUNT_READY"],
    effects: ["CREATE_PUBLICATION"],
    audit: "variant.publish_requested",
  },
  {
    n: 13,
    from: ["SCHEDULED"],
    event: "CANCEL_SCHEDULE",
    to: "APPROVED",
    guards: [],
    effects: ["CANCEL_PUBLICATION"],
    audit: "variant.schedule_cancelled",
  },
  {
    n: 14,
    from: ["SCHEDULED"],
    event: "DISPATCH",
    to: "PUBLISHING",
    guards: ["ACCOUNT_READY"],
    effects: [],
    audit: "variant.publishing_started",
  },
  {
    n: 15,
    from: ["PUBLISHING"],
    event: "PUBLISH_SUCCESS",
    to: "PUBLISHED",
    guards: [],
    effects: [],
    audit: "variant.published",
  },
  {
    n: 16,
    from: ["PUBLISHING"],
    event: "PUBLISH_FAILURE",
    to: "FAILED",
    guards: [],
    effects: [],
    audit: "variant.publish_failed",
  },
  {
    n: 17,
    from: ["FAILED"],
    event: "RETRY",
    to: "PUBLISHING",
    guards: ["ACCOUNT_READY"],
    effects: [],
    audit: "variant.publish_retried",
  },
  {
    n: 17,
    from: ["FAILED"],
    event: "RETRY_SCHEDULED",
    to: "SCHEDULED",
    guards: ["TIME_AT_LEAST_5_MIN", "ACCOUNT_READY"],
    effects: [],
    audit: "variant.publish_rescheduled",
  },
  {
    n: 18,
    from: APPROVED_STATES,
    event: "EDIT",
    to: "READY_FOR_REVIEW",
    guards: ["LOCK_VERSION", "CONFIRM"],
    effects: ["CANCEL_PUBLICATION", "CLEAR_APPROVAL", "REVIEW_EVENT", "RE_RENDER"],
    audit: "variant.approval_invalidated",
  },
  {
    n: 18,
    from: APPROVED_STATES,
    event: "UNAPPROVE",
    to: "READY_FOR_REVIEW",
    guards: ["REASON", "CONFIRM"],
    effects: ["CANCEL_PUBLICATION", "CLEAR_APPROVAL", "REVIEW_EVENT"],
    audit: "variant.unapproved",
  },
];

export function findTransition(from: VariantStatus, event: VariantEvent): TransitionRow | null {
  return VARIANT_TRANSITIONS.find((r) => r.event === event && r.from.includes(from)) ?? null;
}

/** The status `event` leads to from `from`, or null when the machine has no such row. */
export function nextStatus(from: VariantStatus, event: VariantEvent): VariantStatus | null {
  return findTransition(from, event)?.to ?? null;
}

export const canTransition = (from: VariantStatus, event: VariantEvent): boolean =>
  findTransition(from, event) !== null;

/** Like `findTransition`, but throws InvalidStateError when the event is not allowed. */
export function assertTransition(from: VariantStatus, event: VariantEvent): TransitionRow {
  const row = findTransition(from, event);
  if (!row) {
    throw new InvalidStateError(`A ${from} variant cannot take the action ${event}.`, {
      details: {
        from,
        event,
        allowed: VARIANT_TRANSITIONS.filter((r) => r.from.includes(from)).map((r) => r.event),
      },
    });
  }
  return row;
}

/** Events a variant in `from` accepts. */
export const eventsFrom = (from: VariantStatus): VariantEvent[] => [
  ...new Set(VARIANT_TRANSITIONS.filter((r) => r.from.includes(from)).map((r) => r.event)),
];

/** Terminal statuses: nothing leaves them. */
export const TERMINAL_STATUSES: readonly VariantStatus[] = ["PUBLISHED", "REJECTED"];

// ---- Allowed actions for the UI -----------------------------------------------------------------

export const VARIANT_ACTIONS = [
  "edit",
  "regenerateField",
  "regenerate",
  "requestChanges",
  "resubmit",
  "approve",
  "reject",
  "unapprove",
  "schedule",
  "cancelSchedule",
  "publishNow",
  "retry",
] as const;
export type VariantAction = (typeof VARIANT_ACTIONS)[number];

/** Why an action is disabled; the UI shows these in the tooltip (10 §10.3). */
export type Blocker = {
  code:
    | "RENDER_MISSING"
    | "RENDER_RUNNING"
    | "RENDER_STALE"
    | "RENDER_FAILED"
    | "BLOCKING_FLAG"
    | "OFFER_MISSING"
    | "NO_CONTENT"
    | "ROLE";
  message: string;
  /** The flag behind a BLOCKING_FLAG. */
  flag?: string;
};

/** Boxes the approver ticks (05 §5.7 `approveVariant`). */
export type ChecklistItem = "factsChecked" | "safetyChecked" | "manychatConfigured";

export type AllowedAction = {
  action: VariantAction;
  enabled: boolean;
  blockers: Blocker[];
  /** The UI asks "this cancels …" first. */
  confirm: boolean;
  /** Approve only: the items that must be ticked. */
  checklist?: ChecklistItem[];
};

export type RenderState = "NONE" | "RENDERING" | "READY" | "STALE" | "FAILED";

/** What the rules need to know about a variant. */
export type VariantFacts = {
  status: VariantStatus;
  flags: readonly string[];
  render: RenderState;
  hasContent: boolean;
  /** The idea has a commercial intent other than NONE. */
  commercial: boolean;
  hasOffer: boolean;
  /** Taxonomy cta_type of the variant. */
  ctaType: string | null;
};

/** CTAs that send the reader to a ManyChat flow (11 §11.7). */
export const KEYWORD_CTA_TYPES: readonly string[] = ["COMMENT_KEYWORD", "DM_KEYWORD"];

const BLOCKING = new Set<string>(BLOCKING_VARIANT_FLAGS);

const FLAG_HELP: Record<string, string> = {
  UNSUPPORTED_CLAIM: "A claim has no support in the cited cards: fix or remove it.",
  NUMERIC_MISMATCH: "A number differs from the card: correct it.",
  TEXT_OVERFLOW: "Text does not fit its slot: shorten it.",
  MISSING_GLYPH: "A character is missing from the font: replace it.",
  RENDER_FAILED: "The last render failed: try again or edit the text.",
  VISUAL_MISSING: "A picture is missing: regenerate the image.",
  KNOWLEDGE_ARCHIVED: "A cited card is archived: replace the claim.",
};

/** Everything that stops a READY_FOR_REVIEW variant from being approved (10 §10.4.3 row 9). */
export function approvalBlockers(facts: VariantFacts): Blocker[] {
  const blockers: Blocker[] = [];
  if (!facts.hasContent) {
    blockers.push({ code: "NO_CONTENT", message: "There is no draft to approve yet." });
    return blockers;
  }
  const render: Record<RenderState, Blocker | null> = {
    READY: null,
    NONE: { code: "RENDER_MISSING", message: "The carousel has not been rendered yet." },
    RENDERING: { code: "RENDER_RUNNING", message: "The carousel is rendering: wait for it." },
    STALE: {
      code: "RENDER_STALE",
      message: "The carousel is out of date with the text: wait for the new render.",
    },
    FAILED: { code: "RENDER_FAILED", message: "The carousel could not be rendered." },
  };
  const renderBlocker = render[facts.render];
  if (renderBlocker) blockers.push(renderBlocker);
  for (const flag of facts.flags) {
    if (BLOCKING.has(flag)) {
      blockers.push({
        code: "BLOCKING_FLAG",
        flag,
        message: FLAG_HELP[flag] ?? `${flag} blocks approval.`,
      });
    }
  }
  if (facts.commercial && !facts.hasOffer) {
    blockers.push({
      code: "OFFER_MISSING",
      message: "This idea sells a product: choose an offer for the market first.",
    });
  }
  return blockers;
}

/** The boxes the approve dialog shows (10 §10.3). */
export function approvalChecklist(facts: Pick<VariantFacts, "flags" | "ctaType">): ChecklistItem[] {
  const items: ChecklistItem[] = ["factsChecked"];
  if (facts.flags.includes("SAFETY_REVIEW")) items.push("safetyChecked");
  if (facts.ctaType && KEYWORD_CTA_TYPES.includes(facts.ctaType)) items.push("manychatConfigured");
  return items;
}

/** Capabilities that need more than "any active user" (10 §10.6). */
const PUBLISHING_ROLES: readonly UserRole[] = ["owner", "editor"];
const NEEDS_PUBLISHING_ROLE: readonly VariantAction[] = [
  "schedule",
  "cancelSchedule",
  "publishNow",
  "retry",
];

const ACTION_EVENT: Record<VariantAction, VariantEvent> = {
  edit: "EDIT",
  regenerateField: "EDIT",
  regenerate: "START_PIPELINE",
  requestChanges: "REQUEST_CHANGES",
  resubmit: "RESUBMIT",
  approve: "APPROVE",
  reject: "REJECT",
  unapprove: "UNAPPROVE",
  schedule: "SCHEDULE",
  cancelSchedule: "CANCEL_SCHEDULE",
  publishNow: "PUBLISH_NOW",
  retry: "RETRY",
};

/**
 * The actions the review screen offers for a variant: every action the machine has a row for,
 * with whether it can run now and what blocks it. A regenerate of an approved variant is not
 * offered (un-approve first, as `requestVariantRegeneration` demands).
 */
export function allowedActions(facts: VariantFacts, role?: UserRole): AllowedAction[] {
  const result: AllowedAction[] = [];
  for (const action of VARIANT_ACTIONS) {
    const row = findTransition(facts.status, ACTION_EVENT[action]);
    if (!row) continue;
    const blockers: Blocker[] = [];
    if (action === "approve") blockers.push(...approvalBlockers(facts));
    if ((action === "edit" || action === "regenerateField") && !facts.hasContent) {
      blockers.push({ code: "NO_CONTENT", message: "There is no draft to edit yet." });
    }
    if (role && NEEDS_PUBLISHING_ROLE.includes(action) && !PUBLISHING_ROLES.includes(role)) {
      blockers.push({ code: "ROLE", message: "Only an owner or editor can do this." });
    }
    result.push({
      action,
      enabled: blockers.length === 0,
      blockers,
      confirm: row.guards.includes("CONFIRM"),
      ...(action === "approve" ? { checklist: approvalChecklist(facts) } : {}),
    });
  }
  return result;
}

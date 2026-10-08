import type { ForbiddenPattern, MarketBrief, ValidationIssue } from "@rc/db/json";
import type { TemplateRegistry } from "@rc/templates";
import { CTA_KEYWORD, MAX_SLIDES, MIN_SLIDES, validateForbiddenPatterns } from "../validation";

// Checks of the market adapter's plan (plan 07 §7.6.1 "Market adaptation", M2-09): 5–10 slides,
// first slide HOOK, templates that exist and can carry the role, card ids that belong to the
// idea, units from the conversion table, a CTA that fits the offer, and a plan that is not a copy
// of a sibling's. BLOCKER issues go to the one repair; the others are notes for the writer.

export type BriefValidationContext = {
  /** Ids of the cards linked to the idea (PRIMARY and SUPPORTING). */
  ideaKnowledgeIds: ReadonlySet<string>;
  /** The PRIMARY ones: a plan that cites none of them has lost the idea. */
  primaryKnowledgeIds: ReadonlySet<string>;
  /** Templates the plan may use, with their roles (`registry` filtered to P0). */
  templates: Pick<TemplateRegistry, "get">;
  /** Codes of `taxonomy_terms` hook_type and cta_type. */
  hookTypes: ReadonlySet<string>;
  ctaTypes: ReadonlySet<string>;
  market: {
    measurementSystem: "METRIC" | "IMPERIAL" | "DUAL";
    forbiddenPatterns: readonly ForbiddenPattern[];
  };
  /** `display` strings of the conversion table that was injected. */
  conversionDisplays: ReadonlySet<string>;
  /** An offer exists for this idea in this market (the CTA may then ask for a keyword). */
  hasOffer: boolean;
  /** Plans of the markets planned before this one. */
  siblings: readonly {
    marketCode: string;
    hookType: string;
    slidePlan: readonly { role: string; templateId: string }[];
  }[];
};

const KEYWORD_CTA_TYPES = new Set(["COMMENT_KEYWORD", "DM_KEYWORD"]);

const issue = (
  severity: ValidationIssue["severity"],
  code: string,
  fieldPath: string,
  message: string,
  fixHint: string,
): ValidationIssue => ({ code, severity, fieldPath, message, fixHint });

export function validateMarketBrief(
  brief: MarketBrief,
  context: BriefValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { slidePlan } = brief;

  if (slidePlan.length < MIN_SLIDES || slidePlan.length > MAX_SLIDES) {
    issues.push(
      issue(
        "BLOCKER",
        "SLIDE_COUNT",
        "slidePlan",
        `The plan has ${slidePlan.length} slides, it needs ${MIN_SLIDES}–${MAX_SLIDES}.`,
        `Plan between ${MIN_SLIDES} and ${MAX_SLIDES} slides.`,
      ),
    );
  }
  const first = slidePlan[0];
  if (first && first.role !== "HOOK") {
    issues.push(
      issue(
        "BLOCKER",
        "FIRST_SLIDE_NOT_HOOK",
        "slidePlan.0.role",
        `The first slide has the role ${first.role}, it must be HOOK.`,
        "Make the first slide the hook.",
      ),
    );
  }
  const last = slidePlan.at(-1);
  if (last && brief.ctaApproach.ctaType !== "NONE" && last.role !== "CTA") {
    issues.push(
      issue(
        "BLOCKER",
        "LAST_SLIDE_NOT_CTA",
        `slidePlan.${slidePlan.length - 1}.role`,
        `The last slide has the role ${last.role}, but the CTA type is ${brief.ctaApproach.ctaType}.`,
        "End with a CTA slide, or choose the CTA type NONE.",
      ),
    );
  }

  const cited = new Set<string>();
  slidePlan.forEach((slide, i) => {
    const at = (field: string) => `slidePlan.${i}.${field}`;
    const template = context.templates.get(slide.templateId);
    if (!template) {
      issues.push(
        issue(
          "BLOCKER",
          "TEMPLATE_UNKNOWN",
          at("templateId"),
          `The template ${slide.templateId} is not in the catalog.`,
          "Use only the templates of the catalog.",
        ),
      );
    } else if (!(template.roles as readonly string[]).includes(slide.role)) {
      issues.push(
        issue(
          "BLOCKER",
          "TEMPLATE_ROLE_MISMATCH",
          at("templateId"),
          `The template ${slide.templateId} cannot carry the role ${slide.role} (it carries ${template.roles.join(", ")}).`,
          `Choose a template of the catalog that lists ${slide.role}, or another role.`,
        ),
      );
    }
    const foreign = slide.knowledgeIds.filter((id) => !context.ideaKnowledgeIds.has(id));
    if (foreign.length > 0) {
      issues.push(
        issue(
          "BLOCKER",
          "CARD_NOT_IN_IDEA",
          at("knowledgeIds"),
          `The slide cites cards that do not belong to the idea: ${foreign.join(", ")}.`,
          "Cite only the cards given with the idea.",
        ),
      );
    }
    for (const id of slide.knowledgeIds) cited.add(id);
    if (slide.role !== "HOOK" && slide.role !== "CTA" && slide.knowledgeIds.length === 0) {
      issues.push(
        issue(
          "BLOCKER",
          "FACTUAL_SLIDE_UNCITED",
          at("knowledgeIds"),
          `The ${slide.role} slide cites no card.`,
          "Cite the card whose claim the slide states, or drop the slide.",
        ),
      );
    }
  });
  if (
    context.primaryKnowledgeIds.size > 0 &&
    ![...context.primaryKnowledgeIds].some((id) => cited.has(id))
  ) {
    issues.push(
      issue(
        "BLOCKER",
        "PRIMARY_NOT_COVERED",
        "slidePlan",
        "No slide cites a primary card of the idea.",
        "Plan the slides around the primary cards.",
      ),
    );
  } else {
    const missing = [...context.primaryKnowledgeIds].filter((id) => !cited.has(id));
    if (missing.length > 0) {
      issues.push(
        issue(
          "MAJOR",
          "PRIMARY_PARTLY_COVERED",
          "slidePlan",
          `Primary cards not used by any slide: ${missing.join(", ")}.`,
          "Cover every primary card, or say in the risks why one is left out.",
        ),
      );
    }
  }

  if (!context.hookTypes.has(brief.hookType)) {
    issues.push(
      issue(
        "BLOCKER",
        "HOOK_TYPE_UNKNOWN",
        "hookType",
        `"${brief.hookType}" is not a hook type.`,
        "Choose a hook type from the taxonomy.",
      ),
    );
  }

  const { ctaApproach } = brief;
  if (!context.ctaTypes.has(ctaApproach.ctaType)) {
    issues.push(
      issue(
        "BLOCKER",
        "CTA_TYPE_UNKNOWN",
        "ctaApproach.ctaType",
        `"${ctaApproach.ctaType}" is not a CTA type.`,
        "Choose a CTA type from the taxonomy.",
      ),
    );
  }
  if (KEYWORD_CTA_TYPES.has(ctaApproach.ctaType)) {
    if (!context.hasOffer) {
      issues.push(
        issue(
          "BLOCKER",
          "CTA_NEEDS_OFFER",
          "ctaApproach.ctaType",
          `The CTA type ${ctaApproach.ctaType} needs an offer, and this market has none for the idea.`,
          "Choose SAVE, SHARE, FOLLOW or NONE.",
        ),
      );
    }
    if (!ctaApproach.keywordSuggestion) {
      issues.push(
        issue(
          "BLOCKER",
          "CTA_KEYWORD_MISSING",
          "ctaApproach.keywordSuggestion",
          `The CTA type ${ctaApproach.ctaType} needs a keyword.`,
          "Suggest one keyword of 3–16 capitals or digits.",
        ),
      );
    }
  }
  if (ctaApproach.keywordSuggestion && !CTA_KEYWORD.test(ctaApproach.keywordSuggestion)) {
    issues.push(
      issue(
        "BLOCKER",
        "CTA_KEYWORD_INVALID",
        "ctaApproach.keywordSuggestion",
        `The keyword "${ctaApproach.keywordSuggestion}" must be 3–16 capitals or digits.`,
        "Use capitals and digits only, for example ARROZ.",
      ),
    );
  }

  if (brief.unitsPolicy.system !== context.market.measurementSystem) {
    issues.push(
      issue(
        "BLOCKER",
        "UNITS_SYSTEM_MISMATCH",
        "unitsPolicy.system",
        `The plan uses ${brief.unitsPolicy.system} units, the market uses ${context.market.measurementSystem}.`,
        `Set the unit system to ${context.market.measurementSystem}.`,
      ),
    );
  }
  brief.unitsPolicy.conversions.forEach((conversion, i) => {
    if (!context.conversionDisplays.has(conversion.to)) {
      issues.push(
        issue(
          "BLOCKER",
          "CONVERSION_NOT_IN_TABLE",
          `unitsPolicy.conversions.${i}.to`,
          `"${conversion.to}" is not a value of the conversion table.`,
          "Copy the display string of the conversion table exactly; do not compute conversions.",
        ),
      );
    }
  });

  // The market's forbidden patterns apply to the local words the writer will be told to use.
  const terms = [...brief.terminology.map((t) => t.localTerm), ...brief.examples];
  const forbidden = validateForbiddenPatterns(
    {
      hook: "",
      caption: "",
      cta: { type: "NONE", text: "" },
      hashtags: terms,
      slides: [],
    },
    {
      locale: "en",
      forbiddenPatterns: context.market.forbiddenPatterns,
      ideaKnowledgeIds: context.ideaKnowledgeIds,
      numericReference: {},
    },
  );
  for (const found of forbidden) {
    const index = Number(found.fieldPath?.split(".")[1]);
    const inTerms = index < brief.terminology.length;
    issues.push({
      ...found,
      fieldPath: inTerms
        ? `terminology.${index}.localTerm`
        : `examples.${index - brief.terminology.length}`,
    });
  }

  const sequence = slidePlan.map((s) => `${s.role}:${s.templateId}`).join(">");
  for (const sibling of context.siblings) {
    const sameHook = sibling.hookType === brief.hookType;
    const sameStructure =
      sequence === sibling.slidePlan.map((s) => `${s.role}:${s.templateId}`).join(">");
    if (sameHook && sameStructure) {
      issues.push(
        issue(
          "BLOCKER",
          "SAME_AS_SIBLING",
          "slidePlan",
          `The plan repeats the hook type and the slide structure of the ${sibling.marketCode} plan.`,
          "Change the hook type or the order of roles and templates; keep the facts.",
        ),
      );
    } else if (sameHook) {
      issues.push(
        issue(
          "MINOR",
          "SAME_HOOK_TYPE",
          "hookType",
          `The hook type ${brief.hookType} is also used by the ${sibling.marketCode} plan.`,
          "Prefer a different hook type when another one fits the market.",
        ),
      );
    }
  }
  return issues;
}

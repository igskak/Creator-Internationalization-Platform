import { z } from "zod";

// Input and output of the knowledge extractor (plan 07 §7.7). The JSON Schema sent to the model
// allows no length or range limits, so quote length (≤ 400), confidence (0–1), page numbers and
// `safetyReason` are checked in code (07 §7.8) and a violation becomes a repair message.

export const TEMPERATURE_TARGETS = [
  "OVEN",
  "PAN",
  "OIL",
  "WATER",
  "CORE",
  "FRIDGE",
  "FREEZER",
  "OTHER",
] as const;

export const SKIP_REASONS = [
  "FRONT_MATTER",
  "TABLE_OF_CONTENTS",
  "MARKETING",
  "NO_CULINARY_CONTENT",
  "UNREADABLE",
  "REPEATED_CONTENT",
] as const;

const Term = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const ExtractorInput = z
  .object({
    source: z.object({
      title: z.string().min(1),
      type: z.string().min(1),
      author: z.string().optional(),
      /** ISO 639-1 language of the source; cards stay in it. */
      language: z.string().min(1),
    }),
    /** Active taxonomy terms (`taxonomy_terms`); the output enums are built from them. */
    taxonomy: z.object({
      categories: z.array(Term).min(1),
      subcategories: z.array(Term.extend({ parentCode: z.string().min(1) })),
    }),
    /** PDF_NATIVE: the pages come as an attached PDF; TEXT: they are listed in `pages`. */
    mode: z.enum(["PDF_NATIVE", "TEXT"]),
    /** First and last source page of this batch (the attached PDF starts at `pageStart`). */
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    pages: z
      .array(
        z.object({
          number: z.number().int().positive(),
          section: z.string().nullable().optional(),
          text: z.string(),
        }),
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.pageEnd < value.pageStart) {
      ctx.addIssue({ code: "custom", path: ["pageEnd"], message: "pageEnd is before pageStart" });
    }
    if (value.mode === "TEXT" && !value.pages?.length) {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "TEXT mode needs pages" });
    }
  });
export type ExtractorInput = z.infer<typeof ExtractorInput>;

const cardFields = {
  title: z.string(),
  claim: z.string(),
  explanation: z.string(),
  procedure: z.array(z.object({ n: z.number().int(), text: z.string() })),
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().optional(),
      unit: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  temperatures: z.array(
    z.object({
      value: z.number(),
      unit: z.enum(["C", "F"]),
      target: z.enum(TEMPERATURE_TARGETS),
      context: z.string(),
    }),
  ),
  timings: z.array(
    z.object({
      value: z.number(),
      valueMax: z.number().optional(),
      unit: z.enum(["s", "min", "h", "d"]),
      context: z.string(),
    }),
  ),
  commonMistakes: z.array(
    z.object({ mistake: z.string(), why: z.string().optional(), fix: z.string().optional() }),
  ),
  /** Verbatim from the source, at most 400 characters. */
  sourceQuote: z.string(),
  /** Source page numbers, not positions inside an attached sub-PDF. */
  pageStart: z.number().int(),
  pageEnd: z.number().int(),
  sectionHint: z.string().optional(),
  /** 0–1. */
  confidence: z.number(),
  safetySensitive: z.boolean(),
  /** Required when `safetySensitive` is true. */
  safetyReason: z.string().optional(),
};

const skippedPages = z.array(z.object({ page: z.number().int(), reason: z.enum(SKIP_REASONS) }));

/** Structural schema: category codes are plain strings. */
export const KnowledgeCardDraft = z.object({
  category: z.string(),
  subcategory: z.string().optional(),
  ...cardFields,
});
export type KnowledgeCardDraft = z.infer<typeof KnowledgeCardDraft>;

export const ExtractorOutput = z.object({
  cards: z.array(KnowledgeCardDraft),
  skippedPages,
});
export type ExtractorOutput = z.infer<typeof ExtractorOutput>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/**
 * The output schema for one call: `category` and `subcategory` are enums of the active taxonomy
 * codes, so the model cannot invent a code. Without subcategories the field stays free text.
 */
export function extractorOutputFor(input: ExtractorInput): z.ZodType<ExtractorOutput> {
  const subcodes = input.taxonomy.subcategories.map((s) => s.code);
  const card = z.object({
    category: oneOf(input.taxonomy.categories.map((c) => c.code)),
    subcategory: (subcodes.length ? oneOf(subcodes) : z.string()).optional(),
    ...cardFields,
  });
  return z.object({ cards: z.array(card), skippedPages }) as unknown as z.ZodType<ExtractorOutput>;
}

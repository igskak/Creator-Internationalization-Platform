import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// The format of an eval case (plan 07 §7.12): an idea, the approved cards it rests on, the markets,
// and what the drafts must and must not contain. Cases in the repository are synthetic; real
// Reg.Chef cases live outside git and are loaded by path.

const Card = z.object({
  /** A short name used by `expect.mustCite`; the run gives the card its own id. */
  key: z.string().min(1).max(40),
  role: z.enum(["PRIMARY", "SUPPORTING"]).default("PRIMARY"),
  title: z.string().min(1),
  category: z.string().min(1),
  claim: z.string().min(1),
  explanation: z.string().default(""),
  procedure: z
    .array(z.object({ n: z.number().int().positive(), text: z.string().min(1) }))
    .default([]),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.number().nonnegative().optional(),
        unit: z.string().min(1).optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  temperatures: z
    .array(
      z.object({
        value: z.number(),
        unit: z.enum(["C", "F"]),
        target: z.enum(["OVEN", "PAN", "OIL", "WATER", "CORE", "FRIDGE", "FREEZER", "OTHER"]),
        context: z.string(),
      }),
    )
    .default([]),
  timings: z
    .array(
      z.object({
        value: z.number().nonnegative(),
        valueMax: z.number().nonnegative().optional(),
        unit: z.enum(["s", "min", "h", "d"]),
        context: z.string(),
      }),
    )
    .default([]),
  commonMistakes: z
    .array(
      z.object({
        mistake: z.string().min(1),
        why: z.string().optional(),
        fix: z.string().optional(),
      }),
    )
    .default([]),
  safetySensitive: z.boolean().default(false),
  safetyNotes: z.string().nullable().default(null),
  language: z.string().min(1).default("ru"),
});

const MarketNotes = z.object({
  toneNotes: z.string().optional(),
  foodCultureNotes: z.string().optional(),
  preferredVocabulary: z
    .array(
      z.object({
        concept: z.string().min(1),
        preferred: z.string().min(1),
        avoid: z.array(z.string().min(1)).optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  forbiddenPatterns: z
    .array(
      z.object({
        pattern: z.string().min(1),
        kind: z.enum(["PHRASE", "REGEX"]),
        reason: z.string().min(1),
      }),
    )
    .optional(),
});

export const EvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and dashes."),
    description: z.string().default(""),
    brandVoice: z.string().default("Warm, precise, no hype."),
    idea: z.object({
      topic: z.string().min(1),
      category: z.string().min(1),
      angle: z.string().min(1),
      coreMessage: z.string().min(1),
    }),
    cards: z.array(Card).min(1),
    /** Market codes of the run; the seeded markets are `es-ES` and `en`. */
    markets: z.array(z.string().min(1)).min(1).default(["es-ES", "en"]),
    marketNotes: z.record(z.string(), MarketNotes).default({}),
    expect: z
      .object({
        /** Card keys every market's draft must cite on at least one slide. */
        mustCite: z.array(z.string()).default([]),
        /** Phrases no draft may contain (case-insensitive); `market` limits the check to one. */
        forbiddenPhrases: z
          .array(
            z.object({ market: z.string().optional(), phrases: z.array(z.string().min(1)).min(1) }),
          )
          .default([]),
        /** Strings that must appear in the market's draft, e.g. the numeric facts "180 °C". */
        requiredText: z
          .array(z.object({ market: z.string().optional(), text: z.string().min(1) }))
          .default([]),
        /** The markets' hook types must differ (07 §7.10). */
        hookTypesDiffer: z.boolean().default(true),
      })
      .default({ mustCite: [], forbiddenPhrases: [], requiredText: [], hookTypesDiffer: true }),
  })
  .superRefine((value, ctx) => {
    const keys = value.cards.map((c) => c.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["cards"], message: "Card keys must be unique." });
    }
    if (!value.cards.some((c) => c.role === "PRIMARY")) {
      ctx.addIssue({ code: "custom", path: ["cards"], message: "At least one primary card." });
    }
    for (const key of value.expect.mustCite) {
      if (!keys.includes(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["expect", "mustCite"],
          message: `Unknown card key "${key}".`,
        });
      }
    }
  });
export type EvalCase = z.infer<typeof EvalCase>;

/** Reads every `*.json` of `<dir>/cases`, in name order; a bad file names itself in the error. */
export async function loadCases(setDir: string): Promise<EvalCase[]> {
  const dir = join(setDir, "cases");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const cases: EvalCase[] = [];
  for (const file of files) {
    const parsed = EvalCase.safeParse(JSON.parse(await readFile(join(dir, file), "utf8")));
    if (!parsed.success) {
      throw new Error(
        `${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      );
    }
    cases.push(parsed.data);
  }
  const ids = cases.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`Two cases have the id "${dup}".`);
  return cases;
}

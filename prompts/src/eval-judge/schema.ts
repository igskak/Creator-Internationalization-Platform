import { z } from "zod";

// Input and output of the eval judge (plan 07 §7.12, M2-16). A different prompt from the pipeline's
// critic on purpose: it sees only one finished draft and the cards, knows nothing of the plan, the
// sibling or the code's checks, and scores against a fixed rubric, so its judgement is independent
// of the loop that produced the draft. Humans spot-check 20 % of its verdicts.

export const JUDGE_SCORES = ["factualFidelity", "localization", "voice"] as const;

const Card = z.object({
  id: z.string().min(1),
  title: z.string(),
  claim: z.string(),
  explanation: z.string().default(""),
  language: z.string().min(1),
});

export const EvalJudgeInput = z.object({
  /** The brand's voice guide, for the voice score. */
  brandVoice: z.string(),
  idea: z.object({ topic: z.string(), coreMessage: z.string() }),
  /** The approved cards the draft may rest on (the only source of facts). */
  cards: z.array(Card).min(1),
  market: z.object({
    code: z.string().min(1),
    displayName: z.string(),
    language: z.string().min(1),
    toneNotes: z.string(),
  }),
  draft: z.object({
    hook: z.string(),
    slides: z.array(z.object({ role: z.string(), text: z.string(), cites: z.array(z.string()) })),
    caption: z.string(),
    cta: z.string(),
    hashtags: z.array(z.string()),
  }),
});
export type EvalJudgeInput = z.infer<typeof EvalJudgeInput>;

export const EvalJudgeOutput = z.object({
  /** 1–5 each; the range is checked by the runner. */
  scores: z.object({
    factualFidelity: z.number(),
    localization: z.number(),
    voice: z.number(),
  }),
  /** Every statement the cards do not support, quoted from the draft. */
  unsupportedClaims: z.array(z.object({ text: z.string(), reason: z.string() })),
  /** One or two sentences: what a native reader would change first. */
  note: z.string(),
});
export type EvalJudgeOutput = z.infer<typeof EvalJudgeOutput>;

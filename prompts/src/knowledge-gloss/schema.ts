import { z } from "zod";

// Input and output of the card gloss (plan 07 §7.6, M1-24): an English reading aid for a card
// written in another language. It is never approved content and never feeds generation.

export const GlossInput = z.object({
  /** ISO 639-1 language of the card. */
  language: z.string().min(1),
  card: z.object({
    title: z.string().min(1),
    claim: z.string().min(1),
    explanation: z.string(),
  }),
});
export type GlossInput = z.infer<typeof GlossInput>;

export const GlossOutput = z.object({
  title: z.string(),
  claim: z.string(),
  /** Empty when the card has no explanation. */
  explanation: z.string(),
});
export type GlossOutput = z.infer<typeof GlossOutput>;

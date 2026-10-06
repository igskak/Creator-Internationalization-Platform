import { z } from "zod";

// Input and output of the post annotator (plan 07 §7.6, M1-23). The output enums are built from
// the active taxonomy, so the model cannot invent a code; `null` means "no code fits".

const Term = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

export const MAX_POSTS_PER_CALL = 10;

export const AnnotatorInput = z.object({
  /** ISO 639-1 language of the captions (the labels stay as they are). */
  language: z.string().min(1),
  posts: z
    .array(
      z.object({
        id: z.string().min(1),
        format: z.enum(["CAROUSEL", "REEL", "SINGLE_IMAGE"]).nullable().optional(),
        caption: z.string(),
      }),
    )
    .min(1)
    .max(MAX_POSTS_PER_CALL),
  /** Active taxonomy terms (`taxonomy_terms`). */
  taxonomy: z.object({
    categories: z.array(Term).min(1),
    angles: z.array(Term).min(1),
    hookTypes: z.array(Term).min(1),
    ctaTypes: z.array(Term).min(1),
  }),
});
export type AnnotatorInput = z.infer<typeof AnnotatorInput>;

const Annotation = z.object({
  postId: z.string(),
  category: z.string().nullable(),
  angle: z.string().nullable(),
  hookType: z.string().nullable(),
  ctaType: z.string().nullable(),
});

/** Structural schema: codes are plain strings. */
export const AnnotatorOutput = z.object({ annotations: z.array(Annotation) });
export type AnnotatorOutput = z.infer<typeof AnnotatorOutput>;

const oneOf = (codes: readonly string[]) =>
  z.enum(codes as [string, ...string[]]) as unknown as z.ZodType<string>;

/** The schema for one call: ids and codes are enums of what this call was given. */
export function annotatorOutputFor(input: AnnotatorInput): z.ZodType<AnnotatorOutput> {
  const codes = (terms: readonly { code: string }[]) => oneOf(terms.map((t) => t.code)).nullable();
  const annotation = z.object({
    postId: oneOf(input.posts.map((p) => p.id)),
    category: codes(input.taxonomy.categories),
    angle: codes(input.taxonomy.angles),
    hookType: codes(input.taxonomy.hookTypes),
    ctaType: codes(input.taxonomy.ctaTypes),
  });
  return z.object({ annotations: z.array(annotation) }) as unknown as z.ZodType<AnnotatorOutput>;
}

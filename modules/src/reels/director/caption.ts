import { stripEmphasis } from "@rc/templates";

// The Reel's caption (reel-director@2, task G-01): the first line is the chosen hook as the viewer
// read it on the first two cards, the director's caption follows after a blank line. Writing that
// line here, not in the model, keeps the caption true when the reviewer changes the hook.

type Hook = { card: string; ruleCard: string };

const ENDS_A_SENTENCE = /[.!?…:;]$/u;

/** "Hot water on bulgur? Only if it's fine." from the two cards, accents removed. */
export function hookLine(hook: Hook): string {
  const card = stripEmphasis(hook.card).replace(/\s+/gu, " ").trim();
  const rule = stripEmphasis(hook.ruleCard).replace(/\s+/gu, " ").trim();
  if (!rule) return card;
  return `${ENDS_A_SENTENCE.test(card) ? card : `${card}.`} ${rule}`;
}

/** The full caption: the hook line, then the director's caption. */
export const reelCaption = (hook: Hook, body: string): string =>
  [hookLine(hook), body.trim()].filter(Boolean).join("\n\n");

/**
 * The caption with the first line of another hook, when the first paragraph is still the line we
 * wrote for the old hook; null when the reviewer has rewritten it (then the caption is left alone).
 */
export function swapHookLine(caption: string, from: Hook, to: Hook): string | null {
  const old = hookLine(from);
  const [first, ...rest] = caption.split(/\n\s*\n/u);
  if ((first ?? "").trim() !== old) return null;
  return [hookLine(to), ...rest].join("\n\n");
}

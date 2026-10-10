import { definePrompt, type Prompt } from "./define";

// Independent accounts (owner decision 2026-10-10): every market publishes from its own account,
// so no prompt names the brand the knowledge comes from, and the content prompts say that the
// content never does either. `independentVersion` makes the next version of a released prompt in
// which only the opening sentence of the first system block changes; it throws if that sentence
// is not where it was, so a later edit of the released text cannot pass silently.

/** Opening of the prompts that plan, write, review or check content. */
export const CONTENT_INTRO =
  "You work for an internal content tool that turns a chef's own knowledge into original Instagram carousels for several markets. Each market has its own independent account: the content never names the chef, the source material or any brand behind them.";

export type Intro = { from: RegExp; to: string };

export const INTROS = {
  content: {
    from: /^You work for .+?'s internal content tool\. .+?; the tool turns the chef's own knowledge into (?:original )?Instagram carousels(?: for several markets)?\./u,
    to: CONTENT_INTRO,
  },
  knowledgeBase: {
    from: /^You work for .+?'s internal knowledge base\./u,
    to: "You work for an internal knowledge base.",
  },
  contentTool: {
    from: /^You work for .+?'s internal content tool\./u,
    to: "You work for an internal content tool.",
  },
  judge: {
    from: /^You are an independent judge for .+?'s content evaluation\./u,
    to: "You are an independent judge for a content evaluation.",
  },
} satisfies Record<string, Intro>;

export function independentVersion<I, O>(previous: Prompt<I, O>, intro: Intro): Prompt<I, O> {
  const [first, ...rest] = previous.system;
  if (!first || !intro.from.test(first.text)) {
    throw new Error(`${previous.key} has changed shape.`);
  }
  return definePrompt({
    id: previous.id,
    version: previous.version + 1,
    stage: previous.stage,
    input: previous.input,
    output: previous.output,
    ...(previous.outputFor ? { outputFor: previous.outputFor } : {}),
    defaults: previous.defaults,
    system: [{ ...first, text: first.text.replace(intro.from, intro.to) }, ...rest],
    render: previous.render,
    ...(previous.renderTemplate ? { renderTemplate: previous.renderTemplate } : {}),
    changelog: `${previous.key} without the name of the source brand: the market accounts are independent.`,
  });
}

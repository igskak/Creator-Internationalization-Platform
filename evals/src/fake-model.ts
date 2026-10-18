import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import {
  createFakeLLMProvider,
  type LLMProvider,
  type StructuredRequest,
} from "@rc/lib/providers/llm";
import { createE2eLlm } from "@rc/modules/ai";
import { type AnyPrompt, reelDirector, renderPrompt } from "@rc/prompts";
import { FIXTURE_OUTPUT as JUDGE_ANSWER } from "@rc/prompts/fixtures/eval-judge";
import { REEL_EVAL_POSTS } from "@rc/prompts/fixtures/reel-director";

// The model of a fake run: the scripted pipeline model of the E2E server (valid plan, draft and
// review built from the cards of the request) plus a scripted judge. Nothing is paid and nothing
// leaves the machine; the numbers show that the harness works, not how good the prompts are.

/**
 * The Reel director answers with the valid script of the synthetic post whose rendered request it
 * receives (the request text is compared with the render of each post, so nothing is parsed).
 */
function reelDirectorAnswer(request: StructuredRequest<unknown>) {
  const sent = request.messages
    .flatMap((m) => m.content)
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  const rendered = (prompt: AnyPrompt, input: unknown) =>
    renderPrompt(prompt, input)
      .map((part) => part.text)
      .join("");
  // reel-director@2 and @3 answer with the post; v1 (an eval of the old version) without it.
  for (const post of REEL_EVAL_POSTS) {
    if (rendered(reelDirector.reelDirectorV2, post.input) === sent) return post.output;
    if (rendered(reelDirector.reelDirectorV3, post.input) === sent) return post.output;
    if (rendered(reelDirector.reelDirectorV1, post.input) === sent) {
      const { caption: _c, cta: _t, hashtags: _h, ...script } = post.output;
      return script;
    }
  }
  throw new Error("The fake model has no Reel script for this request.");
}

export function createFakeEvalModel(): LLMProvider {
  const pipeline = createE2eLlm();
  const judge = createFakeLLMProvider({ handler: () => JUDGE_ANSWER });
  const reels = createFakeLLMProvider({ handler: (request) => reelDirectorAnswer(request) });
  return {
    id: "fake",
    generateStructured: (request) =>
      request.meta.promptId === "eval-judge"
        ? judge.generateStructured(request)
        : request.meta.promptId === "reel-director"
          ? reels.generateStructured(request)
          : pipeline.generateStructured(request),
  };
}

export const createFakeEvalEmbeddings = () => createFakeEmbeddingProvider();

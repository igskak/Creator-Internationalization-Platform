import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import {
  createFakeLLMProvider,
  type LLMProvider,
  type StructuredRequest,
} from "@rc/lib/providers/llm";
import { createE2eLlm } from "@rc/modules/ai";
import { reelDirector, renderPrompt } from "@rc/prompts";
import { FIXTURE_OUTPUT as JUDGE_ANSWER } from "@rc/prompts/fixtures/eval-judge";
import { REEL_POSTS } from "@rc/prompts/fixtures/reel-director";

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
  const post = REEL_POSTS.find(
    (p) =>
      renderPrompt(reelDirector.reelDirectorV1, p.input)
        .map((part) => part.text)
        .join("") === sent,
  );
  if (!post) throw new Error("The fake model has no Reel script for this request.");
  return post.output;
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

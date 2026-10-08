import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider, type LLMProvider } from "@rc/lib/providers/llm";
import { createE2eLlm } from "@rc/modules/ai";
import { FIXTURE_OUTPUT as JUDGE_ANSWER } from "@rc/prompts/fixtures/eval-judge";

// The model of a fake run: the scripted pipeline model of the E2E server (valid plan, draft and
// review built from the cards of the request) plus a scripted judge. Nothing is paid and nothing
// leaves the machine; the numbers show that the harness works, not how good the prompts are.

export function createFakeEvalModel(): LLMProvider {
  const pipeline = createE2eLlm();
  const judge = createFakeLLMProvider({ handler: () => JUDGE_ANSWER });
  return {
    id: "fake",
    generateStructured: (request) =>
      request.meta.promptId === "eval-judge"
        ? judge.generateStructured(request)
        : pipeline.generateStructured(request),
  };
}

export const createFakeEvalEmbeddings = () => createFakeEmbeddingProvider();

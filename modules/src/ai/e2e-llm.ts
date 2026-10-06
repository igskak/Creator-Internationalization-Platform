import { createFakeLLMProvider } from "@rc/lib/providers/llm";

// The fake model of the E2E server (plan 13 §13.4: `AI_PROVIDER=fake`). It answers the knowledge
// extractor from the pages it is given, so a pasted text becomes cards whose quotes really are in
// the text; every other prompt is refused. Only the web runtime uses it, and only when
// E2E_TEST_AUTH_SECRET is set (which production refuses).

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

/** The first sentence of a page, at most `max` characters, exactly as written. */
function firstSentence(text: string, max: number): string {
  const trimmed = text.trim();
  const end = trimmed.search(/[.!?…](\s|$)/u);
  const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1);
  return sentence.slice(0, max).trim();
}

export function createE2eLlm() {
  return createFakeLLMProvider({
    handler: (request) => {
      if (request.meta.promptId !== "knowledge-extractor") {
        throw new Error(`The E2E model has no answer for ${request.meta.promptId}.`);
      }
      const text = request.messages
        .flatMap((m) => m.content)
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n");
      const pages = [...text.matchAll(/<page n="(\d+)"[^>]*>([\s\S]*?)<\/page>/gu)].map((m) => ({
        number: Number(m[1]),
        text: unescapeXml(m[2] ?? ""),
      }));
      return {
        cards: pages
          .filter((page) => page.text.trim() !== "")
          .map((page) => {
            const sentence = firstSentence(page.text, 300);
            return {
              category: "TECHNIQUES",
              title: sentence.slice(0, 80),
              claim: sentence,
              explanation: "",
              procedure: [],
              ingredients: [],
              temperatures: [],
              timings: [],
              commonMistakes: [],
              sourceQuote: firstSentence(page.text, 300),
              pageStart: page.number,
              pageEnd: page.number,
              confidence: 0.9,
              safetySensitive: false,
            };
          }),
        skippedPages: [],
      };
    },
  });
}

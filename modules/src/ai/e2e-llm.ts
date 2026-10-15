import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import {
  scriptedBrief,
  scriptedDraft,
  scriptedReview,
  scriptedVisualBrief,
} from "./scripted-answers";
import { scriptedReelScript } from "./scripted-reel";

// The fake model of the E2E server (plan 13 §13.4: `AI_PROVIDER=fake`). It answers the knowledge
// extractor from the pages it is given, so a pasted text becomes cards whose quotes really are in
// the text, and the idea generator from the cards it is given (the first card whose title starts
// with "E2E card", else the first card), and the market adapter, the writer and the critic with
// a valid plan, draft and review built on the cards of the request, and the field regenerator with the current value plus "(redone)"; every other prompt is refused. Only the web runtime uses it, and only when
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

/** One idea from the first suitable card of an idea-generator request. */
function answerIdeaGenerator(text: string) {
  const cards = [
    ...text.matchAll(/<card id="([^"]+)"[^>]*category="([^"]*)"[^>]*>\n([^\n]*)\n/gu),
  ].map((m) => ({ id: m[1] ?? "", category: m[2] ?? "", title: unescapeXml(m[3] ?? "") }));
  const card = cards.find((c) => c.title.startsWith("E2E card")) ?? cards[0];
  const category = card?.category ?? "";
  const angle = /<angles>\s*<term code="([^"]+)"/u.exec(text)?.[1] ?? "";
  if (!card) return { ideas: [] };
  return {
    ideas: [
      {
        topic: `Idea from ${card.title}`.slice(0, 80),
        category,
        angle,
        coreMessage: `A scripted idea built on the card "${card.title}".`.slice(0, 300),
        primaryKnowledgeIds: [card.id],
        supportingKnowledgeIds: [],
        recommendedFormat: "CAROUSEL",
        commercialIntent: "NONE",
        productCode: null,
        rationale: "The card states the claim this idea is built on.",
        whyNow: "Scripted answer of the E2E model.",
        differsFromRecent: "Scripted answer of the E2E model.",
      },
    ],
  };
}

/** The ids of the cards of a request, in the order they appear, and the market it is about. */
function pipelineRequest(text: string) {
  const ids = [...text.matchAll(/<card id="([^"]+)"/gu)].map((m) => m[1] ?? "");
  const market = /<market_profile code="([^"]+)"/u.exec(text)?.[1] ?? "";
  // The idea may rest on one card only: the second slot of the plans then cites the same card.
  const cards: [string, string] = [ids[0] ?? "", ids[1] ?? ids[0] ?? ""];
  return { cards, market };
}

/**
 * A new value for the field of a field-regenerator request: the current value with " (redone)"
 * added, so the screen shows a visible change that passes the same checks. Built from the draft in
 * the request, which is escaped XML.
 */
function answerFieldRegenerator(text: string) {
  const attr = (tag: string, name: string) =>
    new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`, "u").exec(text)?.[1];
  const path = unescapeXml(attr("field", "path") ?? "");
  const kind = attr("field", "kind") ?? "";
  const draft = /<current_draft>([\s\S]*?)<\/current_draft>/u.exec(text)?.[1] ?? "";
  const body = (tag: string) =>
    unescapeXml(new RegExp(`<${tag}[^>]*>\\n([\\s\\S]*?)\\n</${tag}>`, "u").exec(draft)?.[1] ?? "");
  const redone = (value: string) => `${value} (redone)`;
  let value: unknown;
  switch (kind) {
    case "hook":
      value = redone(body("hook"));
      break;
    case "caption":
      value = redone(body("caption"));
      break;
    case "hashtags":
      value = body("hashtags").split(/\s+/u).filter(Boolean);
      break;
    case "cta": {
      const cta = /<cta type="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/cta>/u.exec(draft);
      value = { type: cta?.[1] ?? "SAVE", text: redone(unescapeXml(cta?.[2] ?? "")) };
      break;
    }
    case "slot": {
      const slideId = attr("field", "slide") ?? "";
      const slot = attr("field", "slot") ?? "";
      const slide =
        new RegExp(`<slide id="${slideId}"[^>]*>([\\s\\S]*?)</slide>`, "u").exec(draft)?.[1] ?? "";
      const current =
        new RegExp(`<slot name="${slot}">\\n([\\s\\S]*?)\\n</slot>`, "u").exec(slide)?.[1] ?? "";
      value = redone(unescapeXml(current));
      break;
    }
    case "slide": {
      const slideId = attr("field", "slide") ?? "";
      const tag = new RegExp(`<slide id="${slideId}"([^>]*)>([\\s\\S]*?)</slide>`, "u").exec(draft);
      const get = (name: string) =>
        new RegExp(`${name}="([^"]*)"`, "u").exec(tag?.[1] ?? "")?.[1] ?? "";
      value = {
        role: get("role"),
        templateId: get("template"),
        slots: [...(tag?.[2] ?? "").matchAll(/<slot name="([^"]+)">\n([\s\S]*?)\n<\/slot>/gu)].map(
          (m) => ({
            slot: m[1] ?? "",
            text: redone(unescapeXml(m[2] ?? "")),
          }),
        ),
        knowledgeIds: get("cards").split(", ").filter(Boolean),
        factual: get("factual") === "true",
        altText: "A redone slide.",
      };
      break;
    }
    default:
      value = {
        prompt: "Rice grains, macro, soft side light",
        negativePrompt: "text, logo",
        composition: "Low angle",
      };
  }
  return { field: path, value, rationale: "Scripted answer of the E2E model." };
}

export function createE2eLlm() {
  return createFakeLLMProvider({
    handler: (request) => {
      const text = request.messages
        .flatMap((m) => m.content)
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("\n");
      const { promptId } = request.meta;
      if (promptId === "market-adapter" || promptId === "content-writer" || promptId === "critic") {
        const { cards, market } = pipelineRequest(text);
        if (promptId === "market-adapter") return scriptedBrief(market, cards);
        if (promptId === "content-writer") return scriptedDraft(market, cards);
        // The English draft gets a small note, so the review screen has something to show.
        return market === "es-ES"
          ? scriptedReview()
          : scriptedReview({
              issues: [
                {
                  severity: "MINOR",
                  category: "LOCALIZATION",
                  fieldPath: "slides.1.slots.body",
                  explanation: "Scripted note of the E2E model.",
                  suggestedFix: "",
                },
              ],
            });
      }
      if (promptId === "visual-director") return scriptedVisualBrief(text);
      if (promptId === "field-regenerator") return answerFieldRegenerator(text);
      if (promptId === "reel-director") return scriptedReelScript(text);
      if (promptId !== "knowledge-extractor" && promptId !== "idea-generator") {
        throw new Error(`The E2E model has no answer for ${promptId}.`);
      }
      if (promptId === "idea-generator") return answerIdeaGenerator(text);
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

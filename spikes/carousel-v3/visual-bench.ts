import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Slide, VisualBrief } from "../../db/src/json";
import { createOpenAIImageProvider, type ImageAspect } from "../../lib/src/providers/image";
import { createAnthropicProvider } from "../../lib/src/providers/llm";
import { computeCostUsd, STAGE_CONFIG } from "../../modules/src/ai";
import {
  finishPhotoPrompts,
  type RecipeCard,
  validateVisualBrief,
  visualInput,
  visualValidationContext,
} from "../../modules/src/content";
import { normalizeImage, type SlotAspect } from "../../modules/src/visuals";
import { promptRegistry, renderPrompt } from "../../prompts/src";
import { registry } from "../../templates/src";

// `tsx --env-file=<.env> spikes/carousel-v3/visual-bench.ts --post <post.json> --out <dir> [--recipe <cards.json>]
// [--generate] [--version 7]`: runs the active (or a given) visual director on a stored post
// without the database, prints the brief's validation issues, and with --generate draws every
// picture with the live image model, normalized as the pipeline does, into
// `<out>/photo-<slideId>-<slot>.webp` next to a `post.json` with the new brief, ready for
// `pnpm --filter @rc/modules bench:carousel`. Costs money: one director call (about $0.2) and
// about $0.04 per picture. Real content stays out of git: point --out at a git-ignored folder.

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}
const need = (name: string): string => {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
};

const VISUAL_STYLES = [
  "EDITORIAL_MACRO",
  "FOOD_SCIENCE_DIAGRAM",
  "WARM_MEDITERRANEAN",
  "CLEAN_STUDIO",
  "DARK_MOODY",
  "TEXT_FORWARD",
].map((code) => ({ code, label: code.toLowerCase().replaceAll("_", " ") }));

async function main(): Promise<void> {
  const post = JSON.parse(readFileSync(need("post"), "utf8")) as {
    hook?: string;
    caption?: string;
    slides_json: Slide[];
    visual_brief_json?: VisualBrief | null;
  };
  const outDir = need("out");
  mkdirSync(outDir, { recursive: true });
  const recipePath = arg("recipe");
  const cards = recipePath ? (JSON.parse(readFileSync(recipePath, "utf8")) as RecipeCard[]) : [];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const stage = STAGE_CONFIG.VISUAL_DIRECTION;
  const version = Number(arg("version") ?? stage.version);
  const prompt = promptRegistry.get("visual-director", version);
  const slides = post.slides_json;
  const input = visualInput({
    idea: { topic: post.hook ?? "", coreMessage: (post.caption ?? "").split("\n")[0] ?? "" },
    market: { code: "en", displayName: "English", hypotheses: [] },
    slides,
    templates: registry,
    library: [],
    siblings: [],
    visualStyles: VISUAL_STYLES,
    cards,
  });

  const llm = createAnthropicProvider({ apiKey: anthropicKey });
  const answer = await llm.generateStructured({
    model: stage.model,
    system: prompt.system,
    messages: [{ role: "user", content: renderPrompt(prompt, input) }],
    schema: prompt.outputFor ? prompt.outputFor(input as never) : prompt.output,
    schemaName: "visual_brief",
    effort: stage.effort,
    maxTokens: stage.maxTokens,
    meta: { stage: "VISUAL_DIRECTION", promptId: prompt.id, promptVersion: prompt.version },
  });
  const directorCost = computeCostUsd(answer.model, answer.usage) ?? 0;
  if (!answer.data) {
    throw new Error(`No usable brief (${answer.stopReason}): ${answer.validationError ?? ""}`);
  }
  const raw = answer.data as VisualBrief;
  const issues = validateVisualBrief(
    raw,
    visualValidationContext({
      slides,
      templates: registry,
      library: [],
      visualStyles: VISUAL_STYLES,
      hypotheses: [],
    }),
  );
  const brief = finishPhotoPrompts(raw, slides, registry);
  writeFileSync(join(outDir, "brief.json"), JSON.stringify({ brief, issues }, null, 2));
  console.log(
    `${prompt.key}: ${brief.slides.length} pictures, $${directorCost.toFixed(3)}; issues: ${
      issues.map((i) => `${i.severity} ${i.code} ${i.fieldPath}`).join("; ") || "none"
    }`,
  );
  for (const e of raw.slides) {
    console.log(
      `- ${e.slideId}/${e.slot} ${e.shotType ?? ""} ${e.arrangement ?? ""} ${e.placement ?? ""} ${e.vessel ?? ""} «${e.depicts ?? ""}»\n  ${e.prompt ?? ""}`,
    );
  }

  let imageCost = 0;
  if (process.argv.includes("--generate")) {
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not set.");
    const images = createOpenAIImageProvider({ apiKey: openaiKey });
    const jobs = brief.slides.filter((e) => e.source === "GENERATE" && e.prompt);
    const slideById = new Map(slides.map((s) => [s.id, s]));
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const entry = jobs[next++];
        if (!entry) return;
        const slide = slideById.get(entry.slideId);
        const spec = slide ? registry.get(slide.templateId)?.imageSlots[entry.slot] : undefined;
        const generated = await images.generate({
          prompt: entry.prompt ?? "",
          ...(entry.negativePrompt ? { negativePrompt: entry.negativePrompt } : {}),
          aspect: entry.aspect as ImageAspect,
          label: `${entry.slideId}/${entry.slot}`,
        });
        imageCost += generated.costUsd ?? 0;
        const normalized = await normalizeImage(
          generated.bytes,
          (spec?.aspect as SlotAspect | undefined) ?? "4:5",
          { fit: spec?.fullBleed ? "cover" : "contain" },
        );
        writeFileSync(join(outDir, `photo-${entry.slideId}-${entry.slot}.webp`), normalized.bytes);
        console.log(
          `drew ${entry.slideId}/${entry.slot} ($${(generated.costUsd ?? 0).toFixed(3)})`,
        );
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  writeFileSync(
    join(outDir, "post.json"),
    JSON.stringify({ ...post, visual_brief_json: brief }, null, 2),
  );
  console.log(`total $${(directorCost + imageCost).toFixed(3)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

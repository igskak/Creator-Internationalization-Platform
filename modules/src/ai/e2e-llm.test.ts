import { type fieldRegenerator, outputSchema, promptRegistry, renderPrompt } from "@rc/prompts";
import { describe, expect, it } from "vitest";
import { createE2eLlm } from "./e2e-llm";

// The E2E model's answer for the field regenerator must pass the prompt's own output schema for
// every kind of field it is asked about.

const prompt = promptRegistry.get("field-regenerator", 1);
const { FIXTURE_INPUT } = await import("../../../prompts/src/field-regenerator/fixtures");

async function ask(field: fieldRegenerator.FieldRegeneratorInput["field"]) {
  const input = { ...FIXTURE_INPUT, field } as fieldRegenerator.FieldRegeneratorInput;
  const text = renderPrompt(prompt, input)
    .map((p) => p.text)
    .join("\n");
  const schema = outputSchema(prompt, input);
  const result = await createE2eLlm().generateStructured({
    model: "fake",
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    schema,
    schemaName: "field-regenerator",
    maxTokens: 1000,
    meta: { stage: "FIELD_REGENERATION", promptId: "field-regenerator", promptVersion: 1 },
  });
  expect(schema.safeParse(result.data).success).toBe(true);
  return result.data as { field: string; value: unknown };
}

describe("E2E model: field regenerator", () => {
  it("redoes a hook, a caption, hashtags and the CTA", async () => {
    expect(await ask({ path: "hook", kind: "hook" })).toEqual({
      field: "hook",
      value: `${FIXTURE_INPUT.draft.hook} (redone)`,
      rationale: expect.any(String),
    });
    expect((await ask({ path: "caption", kind: "caption" })).value).toBe(
      `${FIXTURE_INPUT.draft.caption} (redone)`,
    );
    expect((await ask({ path: "hashtags", kind: "hashtags" })).value).toEqual(
      FIXTURE_INPUT.draft.hashtags,
    );
    expect((await ask({ path: "cta", kind: "cta" })).value).toMatchObject({
      type: FIXTURE_INPUT.draft.cta.type,
      text: `${FIXTURE_INPUT.draft.cta.text} (redone)`,
    });
  });

  it("redoes a slot and a whole slide, keeping role, template and cards", async () => {
    const slide = FIXTURE_INPUT.draft.slides[1];
    const slot = slide?.slots[0];
    expect(
      (
        await ask({
          path: `slides.${slide?.id}.slots.${slot?.slot}`,
          kind: "slot",
          slideId: slide?.id as string,
          slot: slot?.slot as string,
        })
      ).value,
    ).toBe(`${slot?.text} (redone)`);
    const whole = (
      await ask({ path: `slides.${slide?.id}`, kind: "slide", slideId: slide?.id as string })
    ).value as {
      role: string;
      templateId: string;
      knowledgeIds: string[];
      slots: { text: string }[];
    };
    expect(whole).toMatchObject({ role: slide?.role, templateId: slide?.templateId });
    expect(whole.knowledgeIds).toEqual(slide?.knowledgeIds);
    expect(whole.slots.every((s) => s.text.endsWith("(redone)"))).toBe(true);
  });

  it("plans a picture for an image slot", async () => {
    expect(
      (await ask({ path: "slides.s2.images.side", kind: "image", slideId: "s2", slot: "side" }))
        .value,
    ).toMatchObject({
      prompt: expect.any(String),
      composition: expect.any(String),
    });
  });
});

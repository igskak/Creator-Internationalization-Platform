import { schema } from "@rc/db";
import { asc } from "@rc/db/orm";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { reelDirector } from "@rc/prompts";
import {
  FIXTURE_INPUT_V2 as FIXTURE_INPUT,
  FIXTURE_OUTPUT_V4 as FIXTURE_OUTPUT,
  FIXTURE_OUTPUT_V2 as FIXTURE_OUTPUT_V3,
} from "@rc/prompts/fixtures/reel-director";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext } from "../../core";
import { directReel, toReelScriptDraft } from "./direct";

const logger = createLogger({
  service: "jobs",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

const at = <T>(items: readonly T[], i: number): T => {
  const item = items[i];
  if (item === undefined) throw new Error(`No item at ${i}.`);
  return item;
};

describe("directReel", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const scripted = (...answers: unknown[]) =>
    createFakeLLMProvider({ handler: (_req, i) => answers[Math.min(i, answers.length - 1)] });
  const direct = (llm: ReturnType<typeof scripted>, options: { v3?: boolean } = {}) =>
    directReel(
      createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" }, llm }),
      FIXTURE_INPUT,
      {
        locale: "es-ES",
        ...(options.v3 ? { prompt: reelDirector.reelDirectorV3 } : {}),
      },
    );
  const withCard = (card: string) => {
    const output = structuredClone(FIXTURE_OUTPUT);
    at(output.scenes, 3).card = card;
    return output;
  };

  it("returns the script in its stored shape and logs one REEL_DIRECTION run", async () => {
    const fake = scripted(FIXTURE_OUTPUT);
    const result = await direct(fake);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.issues).toEqual([]);
    expect(result.script?.chosenHookId).toBe("h1");
    expect(result.script?.scenes.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.script?.scenes[1]).toMatchObject({
      line: "El almidón de la superficie es lo que hace el risotto meloso.",
      layout: "FULL",
    });
    expect(result.script?.scenes[0]?.framePrompt).toContain("black enamel bowl");
    expect(result.script?.hookOptions[0]).toMatchObject({
      hookType: "MISTAKE_CALLOUT",
      claimSlideIds: ["c2", "c3"],
    });

    const rows = await t.db
      .select()
      .from(schema.generationRuns)
      .orderBy(asc(schema.generationRuns.createdAt));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stage: "REEL_DIRECTION",
      promptId: "reel-director",
      promptVersion: 4,
    });
  });

  it("still checks an older prompt's script by its own rules (reel-director@3)", async () => {
    const result = await direct(scripted(FIXTURE_OUTPUT_V3), { v3: true });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.script?.scenes).toHaveLength(7);
    expect(result.script?.scenes[0]?.beats).toBe(5);
  });

  it("refuses a v3 script from the active director: the scenes are too short", async () => {
    const result = await direct(scripted(FIXTURE_OUTPUT_V3));
    expect(result.status).toBe("INVALID_OUTPUT");
  });

  it("sends the carousel, the pictures and the hook patterns of the market's language", async () => {
    const fake = scripted(FIXTURE_OUTPUT);
    await direct(fake);
    const text = JSON.stringify(fake.calls[0]?.messages);
    expect(text).toContain('<slide id=\\"c2\\"');
    expect(text).toContain('<picture id=\\"p1\\" slide=\\"c1\\">');
    expect(text).toContain("¿AÚN LAVAS EL ARROZ **DEL RISOTTO?**");
    expect(text).toContain('<type code=\\"MYTH_BUST\\" n=\\"1\\">');
    expect(fake.calls[0]?.meta).toMatchObject({
      stage: "REEL_DIRECTION",
      promptId: "reel-director",
    });
  });

  it("repairs a script that breaks a rule once, with the issue in the request", async () => {
    const fake = scripted(withCard("uno dos tres cuatro cinco seis siete"), FIXTURE_OUTPUT);
    const result = await direct(fake);
    expect(result.status).toBe("REPAIRED");
    expect(fake.calls).toHaveLength(2);
    expect(JSON.stringify(fake.calls[1]?.messages)).toContain("REEL_CARD_WORDS");
    expect(result.script).not.toBeNull();
  });

  it("repairs an id the input does not have, which the schema of the call refuses", async () => {
    const output = structuredClone(FIXTURE_OUTPUT);
    at(output.scenes, 2).sourcePictureId = "p99";
    const fake = scripted(output, FIXTURE_OUTPUT);
    const result = await direct(fake);
    expect(result.status).toBe("REPAIRED");
    expect(JSON.stringify(fake.calls[1]?.messages)).toContain("SCHEMA");
  });

  it("fails after one repair and returns no script", async () => {
    const broken = withCard("uno dos tres cuatro cinco seis siete");
    const fake = scripted(broken);
    const result = await direct(fake);
    expect(result.status).toBe("INVALID_OUTPUT");
    expect(result.script).toBeNull();
    expect(result.issues.map((i) => i.code)).toContain("REEL_CARD_WORDS");
    expect(fake.calls).toHaveLength(2);
  });

  it("does not stop on a note (MAJOR issue)", async () => {
    const output = structuredClone(FIXTURE_OUTPUT);
    at(output.scenes, 3).sourcePictureId = at(output.scenes, 2).sourcePictureId;
    const fake = scripted(output);
    const result = await direct(fake);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.issues.map((i) => i.code)).toEqual(["REEL_PICTURE_REPEAT"]);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("toReelScriptDraft", () => {
  it("holds a v4 hook 3.5 s and fills the frame with every picture", () => {
    const output = structuredClone(FIXTURE_OUTPUT);
    at(output.scenes, 0).beats = 6;
    at(output.scenes, 2).layout = "RIGHT";
    const draft = toReelScriptDraft(output, "v4");
    expect(draft.scenes[0]?.beats).toBe(7);
    expect(draft.scenes.every((s) => s.layout === "FULL")).toBe(true);
    expect(draft.scenes[5]?.line).toContain("Mándaselo");
  });

  it("numbers the scenes and keeps the hook options", () => {
    const draft = toReelScriptDraft(FIXTURE_OUTPUT_V3);
    expect(draft.scenes.at(-1)).toMatchObject({ index: 6, role: "CTA" });
    expect(draft.hookOptions).toHaveLength(3);
  });

  it("keeps the flash opener off and holds the hook scene 2.5 s", () => {
    const output = structuredClone(FIXTURE_OUTPUT_V3);
    output.flashOpener = "ON";
    at(output.scenes, 0).beats = 3;
    const draft = toReelScriptDraft(output);
    expect(draft.flashOpener).toBe("OFF");
    expect(draft.scenes[0]?.beats).toBe(5);
    expect(draft.scenes.slice(1).map((s) => s.beats)).toEqual(
      output.scenes.slice(1).map((s) => s.beats),
    );
  });

  it("refuses a scene that is not on the beat grid", () => {
    const output = structuredClone(FIXTURE_OUTPUT_V3);
    at(output.scenes, 1).beats = 3.25;
    expect(() => toReelScriptDraft(output)).toThrow();
  });
});

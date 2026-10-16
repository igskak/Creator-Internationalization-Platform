import { schema } from "@rc/db";
import { asc } from "@rc/db/orm";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { createLogger } from "@rc/lib/logging";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import {
  FIXTURE_INPUT_V2 as FIXTURE_INPUT,
  FIXTURE_OUTPUT_V2 as FIXTURE_OUTPUT,
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
  const direct = (llm: ReturnType<typeof scripted>) =>
    directReel(
      createServiceContext({ db: t.db, logger, actor: { type: "SYSTEM" }, llm }),
      FIXTURE_INPUT,
      {
        locale: "es-ES",
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
    expect(result.script?.scenes.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
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
      promptVersion: 2,
    });
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
  it("numbers the scenes and keeps the hook options", () => {
    const draft = toReelScriptDraft(FIXTURE_OUTPUT);
    expect(draft.scenes.at(-1)).toMatchObject({ index: 6, role: "CTA" });
    expect(draft.hookOptions).toHaveLength(3);
    expect(draft.flashOpener).toBe("ON");
  });

  it("refuses a scene that is not on the beat grid", () => {
    const output = structuredClone(FIXTURE_OUTPUT);
    at(output.scenes, 0).beats = 3.25;
    expect(() => toReelScriptDraft(output)).toThrow();
  });
});

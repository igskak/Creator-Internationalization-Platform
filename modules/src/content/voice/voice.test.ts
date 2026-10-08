import { schema } from "@rc/db";
import type { RightsPolicy } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { createFakeEmbeddingProvider } from "@rc/lib/providers/embeddings";
import { createFakeLLMProvider } from "@rc/lib/providers/llm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type ServiceContext } from "../../core";
import { generateVariants } from "../pipeline/generate-variants";
import {
  marketOfRequest,
  scriptedBrief,
  scriptedDraft,
  scriptedReview,
  seedAcceptedIdea,
  textOfRequest,
} from "../pipeline/scripted-model";
import { MAX_APPROVED_EXEMPLARS, MAX_EDIT_PAIRS, selectExemplars } from "./select";
import {
  createVoiceExample,
  deleteVoiceExample,
  importVoiceExamples,
  listVoiceExamples,
  parseCsv,
  setVoiceExampleActive,
  updateVoiceExample,
} from "./service";

// Voice examples (M2-17): the CRUD and the seed import, the selection of what the writer sees (with
// the rights exclusion), and the writer actually receiving it. Synthetic content only.

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});

describe("voice examples", () => {
  let t: TestDb;
  let owner: ServiceContext;
  let chef: ServiceContext;
  let esId: string;
  let enId: string;

  const make = (
    role: "owner" | "chef",
    userId: string,
    llm?: ReturnType<typeof createFakeLLMProvider>,
  ) =>
    createServiceContext({
      db: t.db,
      logger,
      embeddings: createFakeEmbeddingProvider(),
      ...(llm ? { llm } : {}),
      actor: { type: "USER", userId, role },
    });

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [user] = await t.db.select().from(schema.appUsers);
    owner = make("owner", user?.id ?? "");
    chef = make("chef", user?.id ?? "");
    const markets = await t.db.select().from(schema.markets);
    esId = markets.find((m) => m.code === "es-ES")?.id ?? "";
    enId = markets.find((m) => m.code === "en")?.id ?? "";
  });
  afterEach(async () => {
    await t.close();
  });

  const pair = (over: object = {}) => ({
    kind: "EDIT_PAIR" as const,
    beforeText: "Descubre el truco",
    afterText: "Deja de lavar el arroz",
    note: "WEAK_HOOK",
    ...over,
  });

  describe("create, update, switch off, delete", () => {
    it("creates each kind with the fields it needs and audits it", async () => {
      const example = await createVoiceExample(owner, {
        kind: "EXEMPLAR",
        afterText: "Un texto aprobado.",
        marketId: esId,
        language: "ES",
      });
      expect(example).toMatchObject({
        kind: "EXEMPLAR",
        source: "SEED",
        isActive: true,
        language: "es",
        marketId: esId,
      });
      expect(await createVoiceExample(owner, pair())).toMatchObject({
        kind: "EDIT_PAIR",
        marketId: null,
        note: "WEAK_HOOK",
      });
      expect(
        await createVoiceExample(owner, { kind: "RULE", note: "Frases cortas." }),
      ).toMatchObject({
        kind: "RULE",
        beforeText: null,
        afterText: null,
      });
      expect(
        (await t.db.select().from(schema.auditEvents)).filter(
          (a) => a.action === "voice_example.created",
        ),
      ).toHaveLength(3);
    });

    it("refuses a row the kind cannot use, field by field", async () => {
      const fields = async (input: object) => {
        const error = await createVoiceExample(owner, input as never).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
        return Object.keys((error as ValidationError).fieldErrors ?? {});
      };
      expect(await fields({ kind: "EXEMPLAR" })).toEqual(["afterText"]);
      expect(await fields({ kind: "EXEMPLAR", afterText: "x", beforeText: "y" })).toEqual([
        "beforeText",
      ]);
      expect(await fields(pair({ beforeText: null }))).toEqual(["beforeText"]);
      expect(await fields(pair({ afterText: "Descubre el truco" }))).toEqual(["afterText"]);
      expect(await fields({ kind: "RULE" })).toEqual(["note"]);
      expect(await fields({ kind: "RULE", note: "x", afterText: "y" })).toEqual(["note"]);
      expect(await fields({ kind: "RULE", note: "x", language: "spanish" })).toContain("language");
      expect(await fields({ kind: "RULE", note: "x", marketId: crypto.randomUUID() })).toEqual([
        "marketId",
      ]);
      expect(await t.db.select().from(schema.voiceExamples)).toHaveLength(0);
    });

    it("only owners and editors write", async () => {
      await expect(createVoiceExample(chef, { kind: "RULE", note: "x" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("updates a seed example, checking the merged result, and keeps a review's row read-only", async () => {
      const row = await createVoiceExample(owner, pair());
      const updated = await updateVoiceExample(owner, {
        id: row.id,
        patch: { afterText: "Otra versión", marketId: enId },
      });
      expect(updated).toMatchObject({
        afterText: "Otra versión",
        marketId: enId,
        beforeText: "Descubre el truco",
      });
      await expect(
        updateVoiceExample(owner, { id: row.id, patch: { kind: "RULE" } }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(updateVoiceExample(owner, { id: row.id, patch: {} })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        updateVoiceExample(owner, { id: crypto.randomUUID(), patch: { note: "x" } }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await t.db
        .update(schema.voiceExamples)
        .set({ source: "REVIEW_EVENT" })
        .where(eq(schema.voiceExamples.id, row.id));
      await expect(
        updateVoiceExample(owner, { id: row.id, patch: { note: "x" } }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(deleteVoiceExample(owner, row.id)).rejects.toBeInstanceOf(InvalidStateError);
      expect((await setVoiceExampleActive(owner, { id: row.id, active: false })).isActive).toBe(
        false,
      );
    });

    it("lists by market (with the all-market rows) and kind, active ones unless asked", async () => {
      const a = await createVoiceExample(owner, {
        kind: "RULE",
        note: "Para España.",
        marketId: esId,
      });
      await createVoiceExample(owner, { kind: "RULE", note: "Para EE. UU.", marketId: enId });
      await createVoiceExample(owner, { kind: "RULE", note: "Para todos." });
      await setVoiceExampleActive(owner, { id: a.id, active: false });
      expect((await listVoiceExamples(owner, { marketId: esId })).map((r) => r.note)).toEqual([
        "Para todos.",
      ]);
      expect(
        await listVoiceExamples(owner, { marketId: esId, includeInactive: true }),
      ).toHaveLength(2);
      expect(await listVoiceExamples(owner, { kind: "EXEMPLAR", includeInactive: true })).toEqual(
        [],
      );
      await deleteVoiceExample(owner, a.id);
      expect(await listVoiceExamples(owner, { includeInactive: true })).toHaveLength(2);
      await expect(deleteVoiceExample(owner, a.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("seed import", () => {
    const rows = [
      {
        market: "es-ES",
        kind: "EDIT_PAIR",
        before: "Descubre el truco",
        after: "Deja de lavar el arroz",
        note: "WEAK_HOOK",
        language: "es",
      },
      { market: "", kind: "RULE", note: "Frases cortas." },
      { market: "en", kind: "EXEMPLAR", after: "Rinse? Not for risotto." },
    ];

    it("imports the rows once and skips what is already there", async () => {
      expect(await importVoiceExamples(owner, rows)).toEqual({ created: 3, skipped: 0 });
      expect(await importVoiceExamples(owner, rows)).toEqual({ created: 0, skipped: 3 });
      expect(await importVoiceExamples(owner, [...rows, rows[0]])).toEqual({
        created: 0,
        skipped: 4,
      });
      const all = await listVoiceExamples(owner);
      expect(all).toHaveLength(3);
      expect(all.every((r) => r.source === "SEED")).toBe(true);
      expect(all.find((r) => r.kind === "RULE")?.marketId).toBeNull();
      expect(all.find((r) => r.kind === "EXEMPLAR")?.marketId).toBe(enId);
    });

    it("refuses the whole file when a row is bad, naming the rows", async () => {
      const error = await importVoiceExamples(owner, [
        rows[0],
        { market: "xx-XX", kind: "RULE", note: "x" },
        { kind: "EDIT_PAIR", before: "same", after: "same" },
        { kind: "NOPE" },
      ]).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).fieldErrors ?? {})).toEqual([
        "row 2",
        "row 3",
        "row 4",
      ]);
      expect((error as ValidationError).fieldErrors?.["row 2"]?.[0]).toContain(
        '"xx-XX" is not a market',
      );
      expect(await listVoiceExamples(owner)).toEqual([]);
      await expect(importVoiceExamples(owner, [])).rejects.toBeInstanceOf(ValidationError);
      await expect(importVoiceExamples(chef, rows)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("reads a CSV with quotes, commas and line breaks in cells", () => {
      const csv =
        'market,kind,before,after,note\n"es-ES",EDIT_PAIR,"Hola, mundo","Hola ""mundo""\nsegunda línea",WEAK_HOOK\n\nen,RULE,,,"Short."\n';
      expect(parseCsv(csv)).toEqual([
        {
          market: "es-ES",
          kind: "EDIT_PAIR",
          before: "Hola, mundo",
          after: 'Hola "mundo"\nsegunda línea',
          note: "WEAK_HOOK",
        },
        { market: "en", kind: "RULE", before: "", after: "", note: "Short." },
      ]);
      expect(parseCsv("")).toEqual([]);
    });
  });

  describe("selectExemplars", () => {
    it("gives rules, seed examples and the newest ten edit pairs of the market, in the language of the market", async () => {
      await createVoiceExample(owner, { kind: "RULE", note: "Frases cortas.", marketId: esId });
      await createVoiceExample(owner, { kind: "RULE", note: "Rule for English.", marketId: enId });
      await createVoiceExample(owner, { kind: "RULE", note: "Para todos." });
      await createVoiceExample(owner, { kind: "RULE", note: "Only English text.", language: "en" });
      await createVoiceExample(owner, {
        kind: "EXEMPLAR",
        afterText: "Un texto aprobado.",
        marketId: esId,
      });
      for (let i = 0; i < 12; i++) {
        await createVoiceExample(
          owner,
          pair({ beforeText: `Antes ${i}`, afterText: `Después ${i}`, marketId: esId }),
        );
      }
      const off = await createVoiceExample(
        owner,
        pair({ beforeText: "Apagado", afterText: "Off", marketId: esId }),
      );
      await setVoiceExampleActive(owner, { id: off.id, active: false });

      const found = await selectExemplars(owner, esId);
      expect(found.map((e) => e.kind)).toEqual([
        "RULE",
        "RULE",
        "EXEMPLAR",
        ...Array.from({ length: MAX_EDIT_PAIRS }, () => "EDIT_PAIR"),
      ]);
      expect(
        found
          .filter((e) => e.kind === "RULE")
          .map((e) => e.text)
          .sort(),
      ).toEqual(["Frases cortas.", "Para todos."]);
      expect(found.find((e) => e.kind === "EXEMPLAR")).toEqual({
        kind: "EXEMPLAR",
        text: "Un texto aprobado.",
      });
      const pairs = found.filter((e) => e.kind === "EDIT_PAIR");
      expect(pairs[0]).toEqual({
        kind: "EDIT_PAIR",
        before: "Antes 11",
        after: "Después 11",
        note: "WEAK_HOOK",
      });
      expect(pairs.at(-1)?.before).toBe("Antes 2");
      // The other market and the other language see their own.
      const english = await selectExemplars(owner, enId);
      expect(english.map((e) => e.text).sort()).toEqual(
        ["Only English text.", "Para todos.", "Rule for English."].sort(),
      );
      expect(await selectExemplars(owner, crypto.randomUUID())).toEqual([]);
    });

    describe("approved drafts of the market", () => {
      let cards: [string, string];
      let ideaId: string;
      let sourceId: string;

      const draft = async (over: Partial<typeof schema.contentVariants.$inferInsert> = {}) => {
        const [idea] = await t.db
          .insert(schema.masterIdeas)
          .values({
            brandId: (await t.db.select().from(schema.brands))[0]?.id ?? "",
            topic: `Idea ${Math.random()}`,
            category: "GRAINS_RICE_PASTA",
            angle: "COMMON_MISTAKE",
            coreMessage: "x",
            status: "ACCEPTED",
            origin: "MANUAL",
          })
          .returning();
        const [row] = await t.db
          .insert(schema.contentVariants)
          .values({
            masterIdeaId: idea?.id ?? ideaId,
            marketId: esId,
            status: "APPROVED",
            hook: "Un gancho",
            caption: "Una caption.",
            lockVersion: 1,
            slidesJson: [
              {
                id: "s1",
                index: 0,
                role: "FACT",
                templateId: "B",
                slots: { body: "Texto de la diapositiva" },
                images: {},
                knowledgeIds: [cards[0]],
                factual: true,
              },
            ],
            ...over,
          })
          .returning();
        return row?.id ?? "";
      };

      beforeEach(async () => {
        const seeded = await seedAcceptedIdea(t.db);
        cards = [seeded.card1, seeded.card2];
        ideaId = seeded.ideaId;
        sourceId = (await t.db.select().from(schema.sourceAssets))[0]?.id ?? "";
      });

      it("takes the three newest approved drafts with at most two edits, not drafts under review or rejected", async () => {
        const base = new Date("2026-10-01T00:00:00Z").getTime();
        const ids: string[] = [];
        for (let i = 0; i < 5; i++)
          ids.push(
            await draft({ statusChangedAt: new Date(base + i * 86_400_000), hook: `Gancho ${i}` }),
          );
        await draft({ status: "READY_FOR_REVIEW", hook: "En revisión" });
        await draft({ status: "REJECTED", hook: "Rechazado" });
        await draft({ marketId: enId, hook: "English hook" });
        await draft({
          lockVersion: 5,
          statusChangedAt: new Date(base + 9 * 86_400_000),
          hook: "Muy editado",
        });
        const found = (await selectExemplars(owner, esId)).filter((e) => e.kind === "EXEMPLAR");
        expect(found).toHaveLength(MAX_APPROVED_EXEMPLARS);
        expect(found.map((e) => e.text?.split("\n")[0])).toEqual([
          "Hook: Gancho 4",
          "Hook: Gancho 3",
          "Hook: Gancho 2",
        ]);
        expect(found[0]?.text).toContain("1. Texto de la diapositiva");
        expect(found[0]?.text).toContain("Caption: Una caption.");
        expect(ids).toHaveLength(5);
      });

      it("leaves out a draft built on a source that does not allow improving prompts", async () => {
        const denied: RightsPolicy = {
          use: "ALLOWED",
          translate: "ALLOWED",
          adapt: "ALLOWED",
          visuallyTransform: "UNKNOWN",
          sell: "UNKNOWN",
          aiProcessing: "ALLOWED",
          improvePrompts: "DENIED",
        };
        const [deniedSource] = await t.db
          .insert(schema.sourceAssets)
          .values({
            brandId: (await t.db.select().from(schema.brands))[0]?.id ?? "",
            type: "GUIDE",
            title: "d",
            originalLanguage: "ru",
            rights: denied,
          })
          .returning();
        await t.db
          .update(schema.knowledgeItems)
          .set({ sourceAssetId: deniedSource?.id ?? null })
          .where(eq(schema.knowledgeItems.id, cards[1]));
        await draft({ hook: "Con permiso" }); // cites card 0: its source has improvePrompts UNKNOWN
        await draft({
          hook: "Sin permiso",
          slidesJson: [
            {
              id: "s1",
              index: 0,
              role: "FACT",
              templateId: "B",
              slots: { body: "x" },
              images: {},
              knowledgeIds: [cards[1]],
              factual: true,
            },
          ],
        });
        const found = (await selectExemplars(owner, esId)).filter((e) => e.kind === "EXEMPLAR");
        expect(found.map((e) => e.text?.split("\n")[0])).toEqual(["Hook: Con permiso"]);
        expect(sourceId).not.toBe(deniedSource?.id);
      });
    });
  });

  describe("the writer receives them", () => {
    it("puts the rules, examples and edit pairs of the market into the writer's prompt", async () => {
      const seeded = await seedAcceptedIdea(t.db);
      const cards: [string, string] = [seeded.card1, seeded.card2];
      await importVoiceExamples(owner, [
        { market: "es-ES", kind: "RULE", note: "Frases cortas. Un dato por diapositiva." },
        {
          market: "es-ES",
          kind: "EDIT_PAIR",
          before: "Descubre el truco",
          after: "Deja de lavar el arroz",
          note: "WEAK_HOOK",
        },
        { market: "en", kind: "RULE", note: "Say it like a friend." },
      ]);
      const llm = createFakeLLMProvider({
        handler: (request) => {
          const market = marketOfRequest(request);
          if (request.meta.promptId === "market-adapter") return scriptedBrief(market, cards);
          if (request.meta.promptId === "content-writer") return scriptedDraft(market, cards);
          return scriptedReview();
        },
      });
      const ctx = make("owner", (await t.db.select().from(schema.appUsers))[0]?.id ?? "", llm);
      const variantIds: string[] = [];
      for (const market of await t.db
        .select()
        .from(schema.markets)
        .where(eq(schema.markets.isActive, true))) {
        const [row] = await t.db
          .insert(schema.contentVariants)
          .values({ masterIdeaId: seeded.ideaId, marketId: market.id })
          .returning();
        variantIds.push(row?.id ?? "");
      }
      await generateVariants(ctx, {
        masterIdeaId: seeded.ideaId,
        variantIds,
        pipelineRunId: "voice-1",
      });

      const writers = llm.calls.filter((r) => r.meta.promptId === "content-writer");
      const spanish = textOfRequest(writers.find((r) => marketOfRequest(r) === "es-ES") as never);
      const english = textOfRequest(writers.find((r) => marketOfRequest(r) === "en") as never);
      expect(spanish).toContain('<example kind="RULE">\nFrases cortas. Un dato por diapositiva.');
      expect(spanish).toContain(
        '<example kind="EDIT_PAIR" note="WEAK_HOOK">\n<before>\nDescubre el truco\n</before>\n<after>\nDeja de lavar el arroz',
      );
      expect(spanish).not.toContain("Say it like a friend.");
      expect(english).toContain("Say it like a friend.");
      expect(english).not.toContain("Frases cortas");
    });
  });
});

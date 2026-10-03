import { schema } from "@rc/db";
import type { RightsPolicy, SourceReference } from "@rc/db/json";
import { asc, eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type JobRunner, type ServiceContext } from "../../core";
import { transitionKnowledgeCard } from "./transition";
import { updateKnowledgeCard } from "./update";

const logger = createLogger({
  service: "web",
  env: "test",
  level: "fatal",
  destination: { write: () => {} },
});
const rights: RightsPolicy = {
  use: "ALLOWED",
  translate: "ALLOWED",
  adapt: "ALLOWED",
  visuallyTransform: "UNKNOWN",
  sell: "UNKNOWN",
  aiProcessing: "ALLOWED",
  improvePrompts: "UNKNOWN",
};

describe("updateKnowledgeCard", () => {
  let t: TestDb;
  let ctx: ServiceContext;
  let brandId: string;
  let sourceId: string;
  let triggered: { name: string; payload: unknown }[];

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    triggered = [];
    const jobs: JobRunner = {
      trigger: async (name, payload) => {
        triggered.push({ name, payload });
        return { runId: "r" };
      },
      triggerAndWaitAll: async () => [],
    };
    const [user] = await t.db.select().from(schema.appUsers);
    ctx = createServiceContext({
      db: t.db,
      logger,
      jobs,
      actor: { type: "USER", userId: user?.id ?? "", role: "editor" },
    });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    const [source] = await t.db
      .insert(schema.sourceAssets)
      .values({
        brandId,
        type: "GUIDE",
        title: "Гайд",
        originalLanguage: "ru",
        rights,
        processingAttempt: 1,
      })
      .returning();
    sourceId = source?.id ?? "";
    await t.db.insert(schema.sourcePages).values({
      sourceAssetId: sourceId,
      pageNumber: 2,
      text: "Гречку варят 15 минут при слабом огне. Остывший рис хранят при 4 градусах.",
      charCount: 70,
      processingAttempt: 1,
    });
  });
  afterEach(async () => {
    await t.close();
  });

  const ref: SourceReference = {
    pageStart: 2,
    pageEnd: 2,
    quote: "Гречку варят 15 минут",
    quoteVerified: true,
  };
  const addCard = async (over: Partial<typeof schema.knowledgeItems.$inferInsert> = {}) => {
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: "Гречка",
        category: "GRAINS_RICE_PASTA",
        claim: "Гречку варят 15 минут.",
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "NEEDS_REVIEW",
        confidence: "0.90",
        sourceAssetId: sourceId,
        sourceReference: ref,
        ...over,
      })
      .returning();
    return row?.id ?? "";
  };
  const card = async (id: string) => {
    const [row] = await t.db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.id, id));
    if (!row) throw new Error("missing");
    return row;
  };
  const audits = async () =>
    await t.db.select().from(schema.auditEvents).orderBy(asc(schema.auditEvents.id));

  it("saves the changed fields and leaves the version of a card that is still in review", async () => {
    const id = await addCard();
    const updated = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: {
        title: "Гречка без каши",
        explanation: "Пар доваривает крупу.",
        subcategory: "BUCKWHEAT",
        tags: ["крупы", "гречка"],
        procedure: [
          { n: 7, text: "Залить водой 1:2." },
          { n: 3, text: "Варить 15 минут." },
        ],
        timings: [{ value: 15, unit: "min", context: "варка" }],
      },
    });
    expect(updated).toMatchObject({
      title: "Гречка без каши",
      explanation: "Пар доваривает крупу.",
      subcategory: "BUCKWHEAT",
      tags: ["крупы", "гречка"],
      version: 1,
      status: "NEEDS_REVIEW",
    });
    expect(updated).not.toHaveProperty("embedding");
    // Steps are numbered by their order.
    expect((await card(id)).procedureJson).toEqual([
      { n: 1, text: "Залить водой 1:2." },
      { n: 2, text: "Варить 15 минут." },
    ]);
    const [event] = (await audits()).filter((e) => e.action === "knowledge.edited");
    expect(event?.data).toMatchObject({ version: { from: 1, to: 1 } });
    expect(((event?.data ?? { fields: [] }) as { fields: string[] }).fields.sort()).toEqual([
      "explanation",
      "procedure",
      "subcategory",
      "tags",
      "timings",
      "title",
    ]);
    expect(triggered).toEqual([
      { name: "embed-knowledge-items", payload: { knowledgeItemIds: [id] } },
    ]);
  });

  it("sends an approved card back to review as the next version, and the approval after it writes that version", async () => {
    const id = await addCard();
    const [chefUser] = await t.db.select().from(schema.appUsers);
    const chef = createServiceContext({
      db: t.db,
      logger,
      actor: { type: "USER", userId: chefUser?.id ?? "", role: "chef" },
    });
    await transitionKnowledgeCard(chef, { id, to: "CHEF_APPROVED" });
    expect(await card(id)).toMatchObject({
      reviewStatus: "CHEF_APPROVED",
      version: 1,
      approvedVersion: 1,
    });

    const edited = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { claim: "Гречку варят ровно 15 минут." },
    });
    expect(edited).toMatchObject({ status: "NEEDS_REVIEW", version: 2, approvedVersion: 1 });
    const [event] = (await audits()).filter((e) => e.action === "knowledge.edited_after_approval");
    expect(event?.data).toMatchObject({
      version: { from: 1, to: 2 },
      status: { from: "CHEF_APPROVED", to: "NEEDS_REVIEW" },
    });

    await transitionKnowledgeCard(chef, { id, to: "CHEF_APPROVED" });
    const versions = await t.db
      .select()
      .from(schema.knowledgeItemVersions)
      .orderBy(asc(schema.knowledgeItemVersions.version));
    expect(versions.map((v) => [v.version, v.snapshot.claim])).toEqual([
      [1, "Гречку варят 15 минут."],
      [2, "Гречку варят ровно 15 минут."],
    ]);
    expect(await card(id)).toMatchObject({ approvedVersion: 2, version: 2 });
  });

  it("refuses a stale version: the second editor loses and nothing changes", async () => {
    const id = await addCard();
    await updateKnowledgeCard(ctx, { id, version: 1, patch: { title: "Первый" } });
    // An approved card moves to version 2; an editor still on version 1 cannot save over it.
    await t.db
      .update(schema.knowledgeItems)
      .set({ version: 2 })
      .where(eq(schema.knowledgeItems.id, id));
    await expect(
      updateKnowledgeCard(ctx, { id, version: 1, patch: { title: "Второй" } }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await card(id)).title).toBe("Первый");
  });

  it("does nothing, and writes no audit event, when nothing really changed", async () => {
    const id = await addCard();
    const before = (await audits()).length;
    const result = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { title: "Гречка", tags: [] },
    });
    expect(result).toMatchObject({ title: "Гречка", version: 1 });
    expect((await audits()).length).toBe(before);
    expect(triggered).toEqual([]);
  });

  it("rejects empty patches, bad values, unknown fields and an unknown category", async () => {
    const id = await addCard();
    const attempt = (patch: object, version = 1) =>
      updateKnowledgeCard(ctx, { id, version, patch } as never);
    await expect(attempt({})).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt({ title: "  " })).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt({ claim: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      attempt({ timings: [{ value: 10, valueMax: 5, unit: "min", context: "x" }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      attempt({ temperatures: [{ value: 5, unit: "K", target: "OVEN", context: "x" }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt({ confidence: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt({ reviewStatus: "CHEF_APPROVED" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const error = await attempt({ category: "NOT_A_CATEGORY" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toHaveProperty("category");
    await expect(attempt({ title: "ok" }, 0)).rejects.toBeInstanceOf(ValidationError);
    expect((await card(id)).title).toBe("Гречка");
  });

  it("changes the category to an active taxonomy term", async () => {
    const id = await addCard();
    expect(
      (await updateKnowledgeCard(ctx, { id, version: 1, patch: { category: "TECHNIQUES" } }))
        .category,
    ).toBe("TECHNIQUES");
  });

  it("refuses to edit an archived card, and reports an unknown one", async () => {
    const archived = await addCard({ reviewStatus: "ARCHIVED" });
    await expect(
      updateKnowledgeCard(ctx, { id: archived, version: 1, patch: { title: "x" } }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      updateKnowledgeCard(ctx, {
        id: "11111111-1111-4111-8111-111111111111",
        version: 1,
        patch: { title: "x" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("re-checks the numbers against the cited pages: a number that is not there raises low confidence, a fixed one clears it", async () => {
    const id = await addCard();
    const wrong = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { timings: [{ value: 45, unit: "min", context: "варка" }] },
    });
    expect(wrong.flags).toContain("LOW_CONFIDENCE");
    const fixed = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { timings: [{ value: 15, unit: "min", context: "варка" }] },
    });
    expect(fixed.flags).not.toContain("LOW_CONFIDENCE");
  });

  it("keeps low confidence that comes from the model's own doubt", async () => {
    const id = await addCard({ confidence: "0.50", reviewFlags: ["LOW_CONFIDENCE"] });
    const result = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { title: "Гречка, правка" },
    });
    expect(result.flags).toContain("LOW_CONFIDENCE");
  });

  it("follows the editor on the safety flag, and raises it for safety keywords only when the editor says nothing", async () => {
    const id = await addCard();
    const raised = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { explanation: "Нельзя есть сырое мясо." },
    });
    expect(raised).toMatchObject({ safetySensitive: true });
    expect(raised.flags).toContain("SAFETY_SENSITIVE");

    const cleared = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { safetySensitive: false },
    });
    expect(cleared.safetySensitive).toBe(false);
    expect(cleared.flags).not.toContain("SAFETY_SENSITIVE");

    const manual = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { safetySensitive: true, safetyNotes: "Хранение" },
    });
    expect(manual).toMatchObject({ safetySensitive: true, safetyNotes: "Хранение" });
    expect(manual.flags).toContain("SAFETY_SENSITIVE");
  });

  it("works for a manual card without a source quote", async () => {
    const id = await addCard({
      sourceAssetId: null,
      sourceReference: null,
      origin: "MANUAL",
      reviewFlags: [],
    });
    const result = await updateKnowledgeCard(ctx, {
      id,
      version: 1,
      patch: { claim: "Новое утверждение" },
    });
    expect(result.claim).toBe("Новое утверждение");
    expect(result.flags).toEqual([]);
  });
});

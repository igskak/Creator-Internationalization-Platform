import { schema } from "@rc/db";
import type { RightsPolicy, SourceReference } from "@rc/db/json";
import { asc, eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceContext, type JobRunner, type ServiceContext } from "../../core";
import { listKnowledgeCards } from "./list";
import { bulkTransitionKnowledgeCards, transitionKnowledgeCard } from "./transition";

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
const ref = (verified: boolean, extra: Partial<SourceReference> = {}): SourceReference => ({
  pageStart: 2,
  pageEnd: 2,
  quote: "цитата",
  quoteVerified: verified,
  matchScore: verified ? 1 : 0.5,
  ...extra,
});

describe("knowledge cards: list and review transitions", () => {
  let t: TestDb;
  let brandId: string;
  let sourceId: string;
  let triggered: { name: string; payload: unknown }[];
  let n = 0;

  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
    const [brand] = await t.db.select().from(schema.brands);
    brandId = brand?.id ?? "";
    sourceId = await addSource("Гайд про крупы", new Date("2026-10-01T10:00:00Z"));
    triggered = [];
    n = 0;
  });
  afterEach(async () => {
    await t.close();
  });

  const jobs: JobRunner = {
    trigger: async (name, payload) => {
      triggered.push({ name, payload });
      return { runId: "r" };
    },
    triggerAndWaitAll: async () => [],
  };
  const ctxFor = (role: "owner" | "editor" | "chef" | "system" = "owner"): ServiceContext =>
    createServiceContext({
      db: t.db,
      logger,
      jobs,
      actor:
        role === "system"
          ? { type: "SYSTEM" }
          : { type: "USER", userId: "00000000-0000-4000-8000-000000000001", role },
    });
  const userCtx = async (role: "owner" | "editor" | "chef") => {
    const [user] = await t.db.select().from(schema.appUsers);
    return createServiceContext({
      db: t.db,
      logger,
      jobs,
      actor: { type: "USER", userId: user?.id ?? "", role },
    });
  };

  async function addSource(title: string, createdAt: Date) {
    const [row] = await t.db
      .insert(schema.sourceAssets)
      .values({ brandId, type: "GUIDE", title, originalLanguage: "ru", rights, createdAt })
      .returning();
    return row?.id ?? "";
  }
  async function addCard(over: Partial<typeof schema.knowledgeItems.$inferInsert> = {}) {
    n += 1;
    const [row] = await t.db
      .insert(schema.knowledgeItems)
      .values({
        brandId,
        title: `Карточка ${n}`,
        category: "TECHNIQUES",
        claim: `Утверждение ${n}`,
        language: "ru",
        origin: "SOURCE_EXTRACTED",
        reviewStatus: "NEEDS_REVIEW",
        confidence: "0.85",
        sourceAssetId: sourceId,
        sourceReference: ref(true),
        ...over,
      })
      .returning();
    return row?.id ?? "";
  }
  const card = async (id: string) => {
    const [row] = await t.db
      .select()
      .from(schema.knowledgeItems)
      .where(eq(schema.knowledgeItems.id, id));
    if (!row) throw new Error("missing");
    return row;
  };
  const audits = async () =>
    (await t.db.select().from(schema.auditEvents).orderBy(asc(schema.auditEvents.id))).map(
      (e) => e.action,
    );

  describe("listKnowledgeCards", () => {
    it("lists cards in review order: verified quote first, then confidence", async () => {
      const unverified = await addCard({
        title: "Не проверена",
        sourceReference: ref(false),
        confidence: "0.99",
      });
      const lowVerified = await addCard({ title: "Проверена, 0.80", confidence: "0.80" });
      const highVerified = await addCard({ title: "Проверена, 0.95", confidence: "0.95" });
      const manual = await addCard({
        title: "Ручная",
        sourceReference: null,
        sourceAssetId: null,
        confidence: "0.90",
        origin: "MANUAL",
      });
      const list = await listKnowledgeCards(ctxFor(), {});
      expect(list.rows.map((r) => r.id)).toEqual([highVerified, lowVerified, manual, unverified]);
      expect(list.rows[0]).toMatchObject({
        title: "Проверена, 0.95",
        status: "NEEDS_REVIEW",
        confidence: 0.95,
        quoteVerified: true,
        matchScore: 1,
        sourceTitle: "Гайд про крупы",
        pageStart: 2,
        flags: [],
      });
      expect(list.rows[2]).toMatchObject({
        quoteVerified: null,
        sourceId: null,
        sourceTitle: null,
      });
      expect(list.rows[3]?.quoteVerified).toBe(false);
    });

    it("puts focus categories first within the same quote status and confidence tier", async () => {
      const a = await addCard({ category: "MEAT", confidence: "0.85" });
      const b = await addCard({ category: "FISH_SEAFOOD", confidence: "0.85" });
      const list = await listKnowledgeCards(ctxFor(), { focusCategories: ["FISH_SEAFOOD"] });
      expect(list.rows.map((r) => r.id)).toEqual([b, a]);
    });

    it("counts statuses with the other filters applied and filters by status", async () => {
      await addCard();
      await addCard({ category: "MEAT" });
      await addCard({ reviewStatus: "CHEF_APPROVED", approvedVersion: 1 });
      await addCard({ reviewStatus: "ARCHIVED" });
      const all = await listKnowledgeCards(ctxFor(), {});
      expect(all.statusCounts).toEqual({
        EXTRACTED: 0,
        NEEDS_REVIEW: 2,
        CHEF_APPROVED: 1,
        ARCHIVED: 1,
      });
      expect(all.total).toBe(4);

      const meat = await listKnowledgeCards(ctxFor(), { categories: ["MEAT"] });
      expect(meat.statusCounts).toMatchObject({ NEEDS_REVIEW: 1, CHEF_APPROVED: 0 });

      const review = await listKnowledgeCards(ctxFor(), { statuses: ["NEEDS_REVIEW"] });
      expect(review.total).toBe(2);
      expect(review.statusCounts.CHEF_APPROVED).toBe(1); // counts ignore the status filter itself
    });

    it("filters by category, source, language and flags", async () => {
      const second = await addSource("Вторая книга", new Date("2026-10-02T10:00:00Z"));
      const a = await addCard({ category: "MEAT", reviewFlags: ["SAFETY_SENSITIVE"] });
      const b = await addCard({
        category: "EGGS",
        sourceAssetId: second,
        reviewFlags: ["LOW_CONFIDENCE", "QUOTE_UNVERIFIED"],
      });
      const c = await addCard({ language: "es", sourceAssetId: second });
      const ids = async (input: Parameters<typeof listKnowledgeCards>[1]) =>
        (await listKnowledgeCards(ctxFor(), input)).rows.map((r) => r.id).sort();
      expect(await ids({ categories: ["MEAT"] })).toEqual([a]);
      expect(await ids({ categories: ["MEAT", "EGGS"] })).toEqual([a, b].sort());
      expect(await ids({ sourceIds: [second] })).toEqual([b, c].sort());
      expect(await ids({ language: "es" })).toEqual([c]);
      expect(await ids({ flags: ["SAFETY_SENSITIVE"] })).toEqual([a]);
      expect(await ids({ flags: ["QUOTE_UNVERIFIED", "SAFETY_SENSITIVE"] })).toEqual([a, b].sort());
      expect(await ids({ categories: ["MEAT"], sourceIds: [second] })).toEqual([]);
    });

    it("builds facets that ignore their own filter, with labels and every flag listed", async () => {
      const second = await addSource("Вторая книга", new Date("2026-10-02T10:00:00Z"));
      await addCard({ category: "MEAT", reviewFlags: ["SAFETY_SENSITIVE"] });
      await addCard({ category: "MEAT" });
      await addCard({ category: "EGGS", sourceAssetId: second });
      const list = await listKnowledgeCards(ctxFor(), { categories: ["MEAT"] });
      expect(list.total).toBe(2);
      expect(list.facets.categories).toEqual([
        { value: "MEAT", count: 2 },
        { value: "EGGS", count: 1 },
      ]);
      expect(list.facets.flags).toEqual([
        { value: "QUOTE_UNVERIFIED", count: 0 },
        { value: "LOW_CONFIDENCE", count: 0 },
        { value: "DUPLICATE_SUSPECTED", count: 0 },
        { value: "SAFETY_SENSITIVE", count: 1 },
      ]);
      expect(list.facets.sources).toEqual([{ value: sourceId, label: "Гайд про крупы", count: 2 }]);
      expect(list.facets.languages).toEqual([{ value: "ru", count: 2 }]);
    });

    it("searches title, claim and explanation case-insensitively, including Cyrillic and wildcards", async () => {
      const a = await addCard({ title: "Гречка без каши" });
      const b = await addCard({ claim: "Крышку не поднимают во время варки ГРЕЧКИ" });
      const c = await addCard({ explanation: "Пар доваривает крупу, 50% воды" });
      await addCard({ title: "Рис" });
      const ids = async (q: string) =>
        (await listKnowledgeCards(ctxFor(), { q })).rows.map((r) => r.id).sort();
      expect(await ids("гречк")).toEqual([a, b].sort());
      expect(await ids("ПАР ДОВАРИВАЕТ")).toEqual([c]);
      expect(await ids("50%")).toEqual([c]);
      expect(await ids("100%")).toEqual([]);
      expect(await ids("_")).toEqual([]);
    });

    it("paginates with a stable order and reports the total", async () => {
      for (let i = 0; i < 5; i++) await addCard({ confidence: "0.90" });
      const first = await listKnowledgeCards(ctxFor(), { pageSize: 2, page: 1 });
      const second = await listKnowledgeCards(ctxFor(), { pageSize: 2, page: 2 });
      const third = await listKnowledgeCards(ctxFor(), { pageSize: 2, page: 3 });
      expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([2, 2, 1]);
      expect(new Set([...first.rows, ...second.rows, ...third.rows].map((r) => r.id)).size).toBe(5);
      expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      await expect(listKnowledgeCards(ctxFor(), { page: 0 })).rejects.toThrow();
      await expect(listKnowledgeCards(ctxFor(), { pageSize: 101 })).rejects.toThrow();
    });

    it("reports the cards that can be approved in bulk: verified quote, no flags, 100 ids at most", async () => {
      await addCard({ sourceReference: ref(false) });
      await addCard({ reviewFlags: ["SAFETY_SENSITIVE"] });
      await addCard({ sourceReference: null, sourceAssetId: null, origin: "MANUAL" });
      await addCard({ reviewStatus: "CHEF_APPROVED", approvedVersion: 1 });
      const clean = await addCard();
      const small = await listKnowledgeCards(ctxFor(), {});
      expect(small.approvable.count).toBe(1);
      expect(small.approvable.ids).toEqual([clean]);

      await t.db.insert(schema.knowledgeItems).values(
        Array.from({ length: 129 }, (_, i) => ({
          brandId,
          title: `Чистая ${i}`,
          category: "TECHNIQUES",
          claim: `Утверждение ${i}`,
          language: "ru",
          origin: "SOURCE_EXTRACTED" as const,
          reviewStatus: "NEEDS_REVIEW" as const,
          confidence: "0.85",
          sourceAssetId: sourceId,
          sourceReference: ref(true),
        })),
      );
      const big = await listKnowledgeCards(ctxFor(), {});
      expect(big.approvable.count).toBe(130);
      expect(big.approvable.ids).toHaveLength(100);
    });

    it("lists 500 cards in under a second with facets and counts", async () => {
      const categories = ["TECHNIQUES", "MEAT", "EGGS", "FISH_SEAFOOD"];
      await t.db.insert(schema.knowledgeItems).values(
        Array.from({ length: 500 }, (_, i) => ({
          brandId,
          title: `Карточка ${i}`,
          category: categories[i % 4] ?? "TECHNIQUES",
          claim: `Утверждение номер ${i} про гречку и воду`,
          explanation: "Объяснение автора",
          language: "ru",
          origin: "SOURCE_EXTRACTED" as const,
          reviewStatus: "NEEDS_REVIEW" as const,
          confidence: (0.5 + (i % 50) / 100).toFixed(2),
          reviewFlags: i % 10 === 0 ? ["SAFETY_SENSITIVE"] : [],
          sourceAssetId: sourceId,
          sourceReference: ref(i % 7 !== 0),
        })),
      );
      const started = performance.now();
      const list = await listKnowledgeCards(ctxFor(), { statuses: ["NEEDS_REVIEW"], q: "гречк" });
      const elapsed = performance.now() - started;
      expect(list.total).toBe(500);
      expect(list.rows).toHaveLength(50);
      expect(list.statusCounts.NEEDS_REVIEW).toBe(500);
      expect(list.facets.categories).toHaveLength(4);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe("transitionKnowledgeCard", () => {
    it("approves a card, snapshots it, records who and when, and asks for its vector", async () => {
      const id = await addCard({
        title: "Гречка",
        claim: "Крышку не поднимают.",
        procedureJson: [{ n: 1, text: "Варить 15 минут." }],
        tags: ["крупы"],
        version: 3,
      });
      const chef = await userCtx("chef");
      const approved = await transitionKnowledgeCard(chef, { id, to: "CHEF_APPROVED" });
      expect(approved).toMatchObject({ reviewStatus: "CHEF_APPROVED", approvedVersion: 3 });
      expect(approved.approvedAt).toBeInstanceOf(Date);
      expect(approved.approvedBy).not.toBeNull();

      const [version] = await t.db.select().from(schema.knowledgeItemVersions);
      expect(version).toMatchObject({ knowledgeItemId: id, version: 3, status: "CHEF_APPROVED" });
      expect(version?.snapshot).toMatchObject({
        title: "Гречка",
        claim: "Крышку не поднимают.",
        procedure: [{ n: 1, text: "Варить 15 минут." }],
        tags: ["крупы"],
        language: "ru",
        sourceReference: expect.objectContaining({ quoteVerified: true }),
      });
      expect(await audits()).toContain("knowledge.approved");
      expect(triggered).toEqual([
        { name: "embed-knowledge-items", payload: { knowledgeItemIds: [id] } },
      ]);
    });

    it("lets the owner and the system approve, but not an editor", async () => {
      const a = await addCard();
      const b = await addCard();
      const c = await addCard();
      await transitionKnowledgeCard(await userCtx("owner"), { id: a, to: "CHEF_APPROVED" });
      await transitionKnowledgeCard(ctxFor("system"), { id: b, to: "CHEF_APPROVED" });
      await expect(
        transitionKnowledgeCard(await userCtx("editor"), { id: c, to: "CHEF_APPROVED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await card(c)).reviewStatus).toBe("NEEDS_REVIEW");
    });

    it("refuses an unverified quote unless the chef accepts it with a note", async () => {
      const id = await addCard({ sourceReference: ref(false), reviewFlags: ["QUOTE_UNVERIFIED"] });
      const chef = await userCtx("chef");
      await expect(
        transitionKnowledgeCard(chef, { id, to: "CHEF_APPROVED" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        transitionKnowledgeCard(chef, { id, to: "CHEF_APPROVED", acceptUnverifiedQuote: true }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((await card(id)).reviewStatus).toBe("NEEDS_REVIEW");

      await transitionKnowledgeCard(chef, {
        id,
        to: "CHEF_APPROVED",
        acceptUnverifiedQuote: true,
        note: "Проверил по книге, стр. 9",
      });
      const [version] = await t.db.select().from(schema.knowledgeItemVersions);
      expect(version?.changeNote).toBe(
        "Approved with an unverified quote: Проверил по книге, стр. 9",
      );
      const [event] = (await t.db.select().from(schema.auditEvents)).filter(
        (e) => e.action === "knowledge.approved",
      );
      expect(event?.data).toMatchObject({
        unverifiedQuoteAccepted: true,
        note: "Проверил по книге, стр. 9",
      });
    });

    it("approves a manual card without a quote, and refuses one with missing fields", async () => {
      const manual = await addCard({
        sourceReference: null,
        sourceAssetId: null,
        origin: "MANUAL",
      });
      await transitionKnowledgeCard(await userCtx("chef"), { id: manual, to: "CHEF_APPROVED" });
      expect((await card(manual)).reviewStatus).toBe("CHEF_APPROVED");
      const empty = await addCard({ claim: "  " });
      await expect(
        transitionKnowledgeCard(ctxFor("system"), { id: empty, to: "CHEF_APPROVED" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("only approves cards in review and reports unknown ids", async () => {
      const approved = await addCard({ reviewStatus: "CHEF_APPROVED", approvedVersion: 1 });
      const archived = await addCard({ reviewStatus: "ARCHIVED" });
      const extracted = await addCard({ reviewStatus: "EXTRACTED" });
      for (const id of [approved, archived, extracted]) {
        await expect(
          transitionKnowledgeCard(ctxFor("system"), { id, to: "CHEF_APPROVED" }),
        ).rejects.toBeInstanceOf(InvalidStateError);
      }
      await expect(
        transitionKnowledgeCard(ctxFor("system"), {
          id: "11111111-1111-4111-8111-111111111111",
          to: "CHEF_APPROVED",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("archives with a reason: anyone for a card in review, chef or owner for an approved one", async () => {
      const inReview = await addCard();
      const approved = await addCard({ reviewStatus: "CHEF_APPROVED", approvedVersion: 1 });
      const editor = await userCtx("editor");
      await expect(
        transitionKnowledgeCard(editor, { id: inReview, to: "ARCHIVED" }),
      ).rejects.toBeInstanceOf(ValidationError);
      const archived = await transitionKnowledgeCard(editor, {
        id: inReview,
        to: "ARCHIVED",
        archiveReason: "OUT_OF_SCOPE",
      });
      expect(archived).toMatchObject({ reviewStatus: "ARCHIVED", archiveReason: "OUT_OF_SCOPE" });

      await expect(
        transitionKnowledgeCard(editor, {
          id: approved,
          to: "ARCHIVED",
          archiveReason: "INACCURATE",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await transitionKnowledgeCard(await userCtx("chef"), {
        id: approved,
        to: "ARCHIVED",
        archiveReason: "INACCURATE",
        note: "Ошибка автора",
      });
      expect((await card(approved)).reviewStatus).toBe("ARCHIVED");
      await expect(
        transitionKnowledgeCard(ctxFor("system"), {
          id: approved,
          to: "ARCHIVED",
          archiveReason: "OTHER",
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      const events = (await t.db.select().from(schema.auditEvents)).filter(
        (e) => e.action === "knowledge.archived",
      );
      expect(events.map((e) => e.data)).toEqual([
        { reason: "OUT_OF_SCOPE", wasApproved: false, from: "NEEDS_REVIEW", to: "ARCHIVED" },
        {
          reason: "INACCURATE",
          wasApproved: true,
          note: "Ошибка автора",
          from: "CHEF_APPROVED",
          to: "ARCHIVED",
        },
      ]);
    });

    it("restores an archived card to review for the chef and owner, clearing the reason", async () => {
      const id = await addCard({ reviewStatus: "ARCHIVED", archiveReason: "DUPLICATE" });
      await expect(
        transitionKnowledgeCard(await userCtx("editor"), { id, to: "NEEDS_REVIEW" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const restored = await transitionKnowledgeCard(await userCtx("chef"), {
        id,
        to: "NEEDS_REVIEW",
      });
      expect(restored).toMatchObject({ reviewStatus: "NEEDS_REVIEW", archiveReason: null });
      expect(await audits()).toContain("knowledge.restored");
      await expect(
        transitionKnowledgeCard(ctxFor("system"), { id, to: "NEEDS_REVIEW" }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });
  });

  describe("bulkTransitionKnowledgeCards", () => {
    it("approves the clean cards and skips the others with a reason", async () => {
      const clean1 = await addCard();
      const clean2 = await addCard();
      const unverified = await addCard({
        sourceReference: ref(false),
        reviewFlags: ["QUOTE_UNVERIFIED"],
      });
      const unverifiedNoFlag = await addCard({ sourceReference: ref(false) });
      const flagged = await addCard({ reviewFlags: ["SAFETY_SENSITIVE"] });
      const already = await addCard({ reviewStatus: "CHEF_APPROVED", approvedVersion: 1 });
      const noClaim = await addCard({ claim: "" });
      const missing = "11111111-1111-4111-8111-111111111111";
      const result = await bulkTransitionKnowledgeCards(await userCtx("chef"), {
        ids: [
          clean1,
          clean2,
          unverified,
          unverifiedNoFlag,
          flagged,
          already,
          noClaim,
          missing,
          clean1,
        ],
        to: "CHEF_APPROVED",
      });
      expect(result.done.sort()).toEqual([clean1, clean2].sort());
      expect(result.skipped).toEqual([
        { id: unverified, reason: "QUOTE_UNVERIFIED" },
        { id: unverifiedNoFlag, reason: "QUOTE_UNVERIFIED" },
        { id: flagged, reason: "HAS_FLAGS" },
        { id: already, reason: "INVALID_STATE" },
        { id: noClaim, reason: "MISSING_FIELDS" },
        { id: missing, reason: "NOT_FOUND" },
      ]);
      expect((await card(unverified)).reviewStatus).toBe("NEEDS_REVIEW");
      expect((await card(clean1)).reviewStatus).toBe("CHEF_APPROVED");
      const versions = await t.db.select().from(schema.knowledgeItemVersions);
      expect(versions.map((v) => v.knowledgeItemId).sort()).toEqual([clean1, clean2].sort());
      expect(triggered.filter((x) => x.name === "embed-knowledge-items")).toHaveLength(2);
    });

    it("never overrides an unverified quote in bulk, whoever asks", async () => {
      const id = await addCard({ sourceReference: ref(false) });
      const result = await bulkTransitionKnowledgeCards(ctxFor("owner"), {
        ids: [id],
        to: "CHEF_APPROVED",
      });
      expect(result).toEqual({ done: [], skipped: [{ id, reason: "QUOTE_UNVERIFIED" }] });
    });

    it("refuses an editor's bulk approval and bad requests before touching a card", async () => {
      const id = await addCard();
      await expect(
        bulkTransitionKnowledgeCards(await userCtx("editor"), { ids: [id], to: "CHEF_APPROVED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        bulkTransitionKnowledgeCards(ctxFor("owner"), { ids: [], to: "CHEF_APPROVED" }),
      ).rejects.toBeInstanceOf(ValidationError);
      const many = Array.from({ length: 101 }, () => "11111111-1111-4111-8111-111111111111");
      await expect(
        bulkTransitionKnowledgeCards(ctxFor("owner"), { ids: many, to: "CHEF_APPROVED" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        bulkTransitionKnowledgeCards(ctxFor("owner"), { ids: [id], to: "ARCHIVED" }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((await card(id)).reviewStatus).toBe("NEEDS_REVIEW");
    });

    it("archives in bulk with one reason and skips cards that are already archived", async () => {
      const a = await addCard();
      const b = await addCard({ reviewStatus: "EXTRACTED" });
      const done = await addCard({ reviewStatus: "ARCHIVED" });
      const result = await bulkTransitionKnowledgeCards(await userCtx("editor"), {
        ids: [a, b, done],
        to: "ARCHIVED",
        archiveReason: "OUT_OF_SCOPE",
      });
      expect(result.done.sort()).toEqual([a, b].sort());
      expect(result.skipped).toEqual([{ id: done, reason: "INVALID_STATE" }]);
      expect(await card(a)).toMatchObject({
        reviewStatus: "ARCHIVED",
        archiveReason: "OUT_OF_SCOPE",
      });
    });

    it("refuses an editor who tries to archive an approved card in bulk", async () => {
      const approved = await addCard({ reviewStatus: "CHEF_APPROVED", approvedVersion: 1 });
      await expect(
        bulkTransitionKnowledgeCards(await userCtx("editor"), {
          ids: [approved],
          to: "ARCHIVED",
          archiveReason: "OTHER",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await card(approved)).reviewStatus).toBe("CHEF_APPROVED");
    });
  });
});

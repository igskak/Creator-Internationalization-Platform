import { schema } from "@rc/db";
import { eq } from "@rc/db/orm";
import { seedDatabase } from "@rc/db/seed";
import { createTestDb, type TestDb } from "@rc/db/test-db";
import { ConflictError } from "@rc/lib/errors";
import { createLogger } from "@rc/lib/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceContext } from "../../core";
import { mergeDuplicateCards } from "./merge";

// Ideas arrive with M2-06a; until then the lookup is replaced to show the refusal.
vi.mock("./usage", () => ({
  ideasUsingCards: async (_ctx: unknown, ids: readonly string[]) =>
    new Map(ids.filter((id) => id === usedId).map((id) => [id, [{ id: "i1", topic: "Крупы" }]])),
}));
let usedId = "";

describe("mergeDuplicateCards and ideas", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedDatabase(t.db, { ownerEmails: ["owner@example.com"] });
  });
  afterEach(async () => {
    await t.close();
  });

  it("refuses a duplicate that an idea uses and archives nothing", async () => {
    const [user] = await t.db.select().from(schema.appUsers);
    const [brand] = await t.db.select().from(schema.brands);
    const ctx = createServiceContext({
      db: t.db,
      logger: createLogger({
        service: "web",
        env: "test",
        level: "fatal",
        destination: { write: () => {} },
      }),
      actor: { type: "USER", userId: user?.id ?? "", role: "owner" },
    });
    const add = async (title: string) => {
      const [row] = await t.db
        .insert(schema.knowledgeItems)
        .values({
          brandId: brand?.id ?? "",
          title,
          category: "GRAINS_RICE_PASTA",
          claim: title,
          language: "ru",
          origin: "MANUAL",
          reviewStatus: "CHEF_APPROVED",
        })
        .returning();
      return row?.id ?? "";
    };
    const keep = await add("Гречка");
    const free = await add("Копия 1");
    usedId = await add("Копия 2");
    await expect(
      mergeDuplicateCards(ctx, { keepId: keep, duplicateIds: [free, usedId] }),
    ).rejects.toThrow(ConflictError);
    for (const id of [free, usedId]) {
      const [row] = await t.db
        .select()
        .from(schema.knowledgeItems)
        .where(eq(schema.knowledgeItems.id, id));
      expect(row?.reviewStatus).toBe("CHEF_APPROVED");
    }
  });
});

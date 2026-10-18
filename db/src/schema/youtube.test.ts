import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { YouTubeError, YouTubeMetadata } from "../json";
import { createTestDb, type TestDb } from "../test-db";

describe("0014_youtube_shorts", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("enables RLS on youtube_uploads", async () => {
    const result = await t.db.execute<{ relrowsecurity: boolean }>(
      sql`select relrowsecurity from pg_class where relname = 'youtube_uploads'`,
    );
    expect(result.rows).toEqual([{ relrowsecurity: true }]);
  });

  it("keeps updated_at current with the shared trigger", async () => {
    const result = await t.db.execute<{ tgname: string }>(
      sql`select tgname from pg_trigger where tgrelid = 'youtube_uploads'::regclass and not tgisinternal`,
    );
    expect(result.rows.map((r) => r.tgname)).toEqual(["youtube_uploads_set_updated_at"]);
  });

  it("limits a Short's title to 100 characters and its privacy to YouTube's three values", () => {
    const ok = {
      title: "A title",
      description: "d #Shorts",
      tags: [],
      categoryId: "26",
      defaultLanguage: "en",
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    };
    expect(YouTubeMetadata.safeParse(ok).success).toBe(true);
    expect(YouTubeMetadata.safeParse({ ...ok, title: "x".repeat(101) }).success).toBe(false);
    expect(YouTubeMetadata.safeParse({ ...ok, privacyStatus: "everyone" }).success).toBe(false);
    expect(YouTubeError.safeParse({ message: "m", classification: "AUTH" }).success).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPoolerUrl } from "./client";
import { MIGRATIONS_FOLDER } from "./paths";
import { createTestDb, type TestDb } from "./test-db";

const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")) as {
  entries: unknown[];
};

describe("createTestDb", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("applies the migrations, including the vector extension", async () => {
    const extensions = await testDb.db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'vector'`,
    );
    expect(extensions.rows).toEqual([{ extname: "vector" }]);
    const applied = await testDb.db.execute<{ hash: string }>(
      sql`select hash from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows).toHaveLength(journal.entries.length);
  });

  it("runs a cosine similarity query with an HNSW index", async () => {
    const { db } = testDb;
    await db.execute(sql`create table items (id int primary key, embedding vector(3))`);
    await db.execute(
      sql`create index items_embedding_idx on items using hnsw (embedding vector_cosine_ops)`,
    );
    await db.execute(sql`insert into items values
      (1, '[1,0,0]'), (2, '[0,1,0]'), (3, '[0.9,0.1,0]')`);

    const nearest = await db.execute<{ id: number; distance: number }>(sql`
      select id, embedding <=> '[1,0,0]' as distance
      from items order by embedding <=> '[1,0,0]' limit 2`);
    expect(nearest.rows.map((r) => r.id)).toEqual([1, 3]);
    expect(nearest.rows[0]?.distance).toBeCloseTo(0);
  });

  it("gives each call its own empty database", async () => {
    const other = await createTestDb();
    const tables = await other.db.execute(
      sql`select 1 from information_schema.tables where table_name = 'items'`,
    );
    expect(tables.rows).toHaveLength(0);
    await other.close();
  });
});

describe("isPoolerUrl", () => {
  it("detects the Supabase transaction pooler port", () => {
    expect(
      isPoolerUrl(
        "postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe(true);
    expect(
      isPoolerUrl(
        "postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
      ),
    ).toBe(false);
    expect(isPoolerUrl("postgresql://postgres:pw@db.ref.supabase.co:5432/postgres")).toBe(false);
  });
});

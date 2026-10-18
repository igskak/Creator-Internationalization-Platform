// Read-only: how rich the approved knowledge cards are (counts only, no card text), to see what
// the closed-book writer has to work with (docs/design/carousel-v3-requirements.md, finding F13).
//   tsx --env-file=<.env> spikes/carousel-v3/kb-stats.ts
import { createDb } from "../../db/src/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const { db, close } = createDb(url, { pooled: url.includes(":6543"), max: 1 });
const sql = (db as unknown as { $client: { unsafe: (q: string, p?: unknown[]) => Promise<any[]> } })
  .$client;
try {
  const tables = await sql.unsafe(
    `select table_name from information_schema.tables
      where table_schema = 'public' and (table_name like 'knowledge%' or table_name like 'source%')
      order by 1`,
  );
  console.log("tables:", tables.map((r) => r.table_name).join(", "));
  const cols = await sql.unsafe(
    `select table_name, string_agg(column_name, ',' order by ordinal_position) as cols
       from information_schema.columns
      where table_schema = 'public' and table_name in ('knowledge_items', 'knowledge_versions')
      group by table_name`,
  );
  for (const c of cols) console.log(c.table_name, ":", c.cols);
  const [stats] = await sql.unsafe(
    `select count(*) as cards,
            count(*) filter (where approved_version is not null) as approved,
            count(*) filter (where jsonb_array_length(coalesce(procedure_json, '[]'::jsonb)) > 0) as with_steps,
            count(*) filter (where jsonb_array_length(coalesce(ingredients_json, '[]'::jsonb)) > 0) as with_ingredients,
            count(*) filter (where jsonb_array_length(coalesce(timings_json, '[]'::jsonb)) > 0) as with_timings,
            count(*) filter (where jsonb_array_length(coalesce(temperatures_json, '[]'::jsonb)) > 0) as with_temperatures,
            count(*) filter (where coalesce(length(explanation), 0) > 0) as with_explanation,
            round(avg(length(claim))) as avg_claim_chars
       from knowledge_items where archive_reason is null`,
  );
  console.log("cards:", JSON.stringify(stats));
  const sources = await sql.unsafe(
    `select a.type, count(distinct a.id) as assets, count(p.id) as pages
       from source_assets a left join source_pages p on p.source_asset_id = a.id
      group by a.type order by 1`,
  );
  console.log("sources:", JSON.stringify(sources));
  const batches = await sql.unsafe(
    `select status, count(*) as n from knowledge_extraction_batches group by status`,
  );
  console.log("extraction batches:", JSON.stringify(batches));
} finally {
  await close();
}

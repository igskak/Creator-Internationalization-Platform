import { EnvValidationError, loadSeedEnv } from "@rc/lib/env";
import { createDb, isPoolerUrl } from "../client";
import { seedDatabase } from "./index";

// `pnpm db:seed`: inserts missing reference rows (brand, markets, taxonomy, owners, settings).
const env = (() => {
  try {
    return loadSeedEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    console.error(`db:seed: ${error.message}`);
    process.exit(1);
  }
})();

const url = env.db.directUrl ?? env.db.url;
const { db, close } = createDb(url, { pooled: isPoolerUrl(url), max: 1 });
try {
  const inserted = await seedDatabase(db, { ownerEmails: env.ownerEmails });
  console.log(`db:seed: inserted ${JSON.stringify(inserted)} (${new URL(url).host})`);
} finally {
  await close();
}

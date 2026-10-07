/**
 * Leftover-row check and reset for the test database. Connects as the owner (TEST_DIRECT_URL).
 *   node scripts/with-test-db.mjs node scripts/test-db-check.mjs          report leftovers
 *   node scripts/with-test-db.mjs node scripts/test-db-check.mjs --reset  empty the test tables
 * Audit rows (append-only), the leave catalog, document categories, and Prisma's migration table are ignored.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { assertTestDatabase } from "./test-db-guard.mjs";

const IGNORED = new Set([
  "_prisma_migrations",
  "audit_log",
  "leave_types",
  "leave_policies",
  "document_categories",
]);

async function connect() {
  assertTestDatabase(process.env, { requireAppUrl: false });
  const client = new pg.Client({ connectionString: process.env.TEST_DIRECT_URL });
  await client.connect();
  const { rows } = await client.query("SELECT current_database() AS name");
  if (!rows[0].name.endsWith("_test")) {
    await client.end();
    throw new Error(`Connected to ${rows[0].name}, which is not a test database.`);
  }
  return client;
}

async function checkedTables(client) {
  const { rows } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((row) => row.tablename).filter((name) => !IGNORED.has(name));
}

/** Tables that still hold rows, with counts. */
export async function findLeftovers() {
  const client = await connect();
  try {
    const leftovers = [];
    for (const table of await checkedTables(client)) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
      if (rows[0].n > 0) leftovers.push({ table, rows: rows[0].n });
    }
    return leftovers;
  } finally {
    await client.end();
  }
}

export async function resetTestDatabase() {
  const client = await connect();
  try {
    const tables = await checkedTables(client);
    if (tables.length === 0) return;
    await client.query("BEGIN");
    const protectedTable = await client.query("SELECT to_regclass('public.attendance_events') AS t");
    if (protectedTable.rows[0].t) await client.query('ALTER TABLE "attendance_events" DISABLE TRIGGER USER');
    await client.query(`TRUNCATE ${tables.map((table) => `"${table}"`).join(", ")}`);
    if (protectedTable.rows[0].t) await client.query('ALTER TABLE "attendance_events" ENABLE TRIGGER USER');
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function describeLeftovers(leftovers) {
  return leftovers.map((row) => `  ${row.table}: ${row.rows}`).join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--reset")) {
    await resetTestDatabase();
    console.log("Test database emptied (audit rows and the leave catalog kept).");
  } else {
    const leftovers = await findLeftovers();
    if (leftovers.length === 0) {
      console.log("No leftover test rows.");
    } else {
      console.log(`Leftover test rows:\n${describeLeftovers(leftovers)}`);
      process.exit(1);
    }
  }
}

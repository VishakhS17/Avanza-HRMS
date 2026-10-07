/**
 * Runs a command against the test database only:
 *   node scripts/with-test-db.mjs npx prisma migrate deploy
 * DATABASE_URL and DIRECT_URL are replaced with TEST_DATABASE_URL and TEST_DIRECT_URL.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { assertTestDatabase, testDatabaseEnv } from "./test-db-guard.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-test-db.mjs <command> [args...]");
  process.exit(1);
}

assertTestDatabase(process.env, { requireAppUrl: false });
const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: testDatabaseEnv(),
});
process.exit(result.status ?? 1);

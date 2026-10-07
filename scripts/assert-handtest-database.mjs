/**
 * Runs a command only when DATABASE_URL is the dev database (see handtest-guard.mjs).
 *   node scripts/assert-handtest-database.mjs tsx scripts/seed-handtest.ts
 * With no command, it only checks and exits.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { assertHandtestDatabase } from "./handtest-guard.mjs";

assertHandtestDatabase();

const [command, ...args] = process.argv.slice(2);
if (!command) process.exit(0);

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});
process.exit(result.status ?? 1);

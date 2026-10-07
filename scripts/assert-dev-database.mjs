/**
 * Runs a local command only when DATABASE_URL and DIRECT_URL are not the production host.
 *   node scripts/assert-dev-database.mjs next dev
 * With no command, it only checks and exits.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { assertNotProductionHost } from "./db-host-guard.mjs";

assertNotProductionHost();

const [command, ...args] = process.argv.slice(2);
if (!command) process.exit(0);

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});
process.exit(result.status ?? 1);

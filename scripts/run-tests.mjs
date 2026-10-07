/**
 * `npm test`: runs every src/**\/*.test.ts file one at a time against the test database.
 * Refuses to start unless the guard passes and the test database starts empty, then fails
 * if any test left rows behind (audit rows and the leave catalog are ignored).
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { assertTestDatabase, testDatabaseEnv } from "./test-db-guard.mjs";
import { describeLeftovers, findLeftovers } from "./test-db-check.mjs";

assertTestDatabase(process.env, { requireAppUrl: true });

const before = await findLeftovers();
if (before.length > 0) {
  console.error(
    `The test database is not empty before the run:\n${describeLeftovers(before)}\nRun npm run db:test:reset, then try again.`,
  );
  process.exit(1);
}

const files = globSync("src/**/*.test.ts").sort();
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
  { stdio: "inherit", env: testDatabaseEnv() },
);

const after = await findLeftovers();
if (after.length > 0) {
  console.error(`Tests left rows behind:\n${describeLeftovers(after)}`);
  process.exit(1);
}
console.log("Leftover check: no test rows remain.");
process.exit(result.status ?? 1);

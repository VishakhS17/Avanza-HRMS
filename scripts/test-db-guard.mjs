/**
 * Refuses to point tests or test-database commands at anything but a separate test database.
 *
 * TEST_DIRECT_URL (owner) and TEST_DATABASE_URL (app role) must:
 * - name a database ending in `_test`,
 * - not use the host in PRODUCTION_DATABASE_HOST (required),
 * - not use the host in DEV_DATABASE_HOST (required),
 * - not be the same host and database as DATABASE_URL or DIRECT_URL.
 * NODE_ENV=production is refused outright.
 */

import { hostKey } from "./db-host-guard.mjs";

const APP_ROLE = "avanza_hrms_app";

function fail(message) {
  console.error(`Refusing to run: ${message}`);
  process.exit(1);
}

export { hostKey };

export function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function target(url) {
  return `${hostKey(url)}/${databaseName(url)}`;
}

function parse(name, url) {
  try {
    new URL(url);
  } catch {
    fail(`${name} is not a valid connection string.`);
  }
  return url;
}

export function assertTestDatabase(env = process.env, { requireAppUrl = true } = {}) {
  if (env.NODE_ENV === "production") fail("NODE_ENV is production.");

  const production = env.PRODUCTION_DATABASE_HOST?.trim();
  if (!production) {
    fail("PRODUCTION_DATABASE_HOST is not set. Set it to the production database host so tests can avoid it.");
  }
  const devHost = env.DEV_DATABASE_HOST?.trim();
  if (!devHost) {
    fail("DEV_DATABASE_HOST is not set. Set it to the dev database host so tests can avoid it.");
  }

  const urls = [];
  if (!env.TEST_DIRECT_URL) fail("TEST_DIRECT_URL is not set.");
  urls.push(["TEST_DIRECT_URL", parse("TEST_DIRECT_URL", env.TEST_DIRECT_URL)]);
  if (requireAppUrl) {
    if (!env.TEST_DATABASE_URL) fail("TEST_DATABASE_URL is not set. Run npm run db:test:roles to get it.");
    urls.push(["TEST_DATABASE_URL", parse("TEST_DATABASE_URL", env.TEST_DATABASE_URL)]);
    if (new URL(env.TEST_DATABASE_URL).username !== APP_ROLE) {
      fail(`TEST_DATABASE_URL must connect as ${APP_ROLE}.`);
    }
  }
  if (new URL(env.TEST_DIRECT_URL).username === APP_ROLE) {
    fail("TEST_DIRECT_URL must connect as the owner role, not the app role.");
  }

  // Inside a with-test-db child, DATABASE_URL and DIRECT_URL are already the test values.
  // The parent's originals travel as DEV_DATABASE_URL and DEV_DIRECT_URL.
  const dev = ["DATABASE_URL", "DIRECT_URL"]
    .map((name) => [name, env[`DEV_${name}`] ?? env[name]])
    .filter(([, url]) => url)
    .map(([name, url]) => [name, target(url)]);

  for (const [name, url] of urls) {
    if (!databaseName(url).endsWith("_test")) fail(`${name} must name a database ending in _test.`);
    if (hostKey(url) === hostKey(production)) fail(`${name} uses the production database host.`);
    if (hostKey(url) === hostKey(devHost)) fail(`${name} uses the dev database host.`);
    for (const [devName, devTarget] of dev) {
      if (target(url) === devTarget) fail(`${name} points at the same database as ${devName}.`);
    }
  }
}

/** Env for a child process that may only reach the test database. */
export function testDatabaseEnv(env = process.env) {
  return {
    ...env,
    DEV_DATABASE_URL: env.DEV_DATABASE_URL ?? env.DATABASE_URL ?? "",
    DEV_DIRECT_URL: env.DEV_DIRECT_URL ?? env.DIRECT_URL ?? "",
    DATABASE_URL: env.TEST_DATABASE_URL ?? "",
    DIRECT_URL: env.TEST_DIRECT_URL,
  };
}

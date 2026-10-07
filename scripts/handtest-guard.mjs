/**
 * Refuses hand-test seeding unless the env points at the dev database.
 *
 * DATABASE_URL (and DIRECT_URL, when set) must:
 * - not be used while NODE_ENV is production,
 * - not use the host in PRODUCTION_DATABASE_HOST (required),
 * - not use the host of TEST_DATABASE_URL or TEST_DIRECT_URL,
 * - name the database avanza_hrms_dev.
 * AUTH_ALLOWED_EMAIL_DOMAIN must be a reserved example domain, so sample users never get real addresses.
 */

import { hostKey } from "./db-host-guard.mjs";

export const HANDTEST_DATABASE = "avanza_hrms_dev";

const FAKE_DOMAIN = /(^|\.)(example|test|invalid|localhost)$|^example\.(com|net|org)$/;

export function isFakeEmailDomain(domain) {
  return FAKE_DOMAIN.test(domain.trim().toLowerCase().replace(/^@/, ""));
}

/** @returns {string | null} a refusal reason, or null when the env may proceed */
export function handtestDatabaseProblem(env = process.env) {
  if (env.NODE_ENV === "production") return "NODE_ENV is production.";
  if (!env.DATABASE_URL) return "DATABASE_URL is not set.";

  const production = env.PRODUCTION_DATABASE_HOST?.trim();
  if (!production) {
    return "PRODUCTION_DATABASE_HOST is not set. Set it to the production database host so this script can avoid it.";
  }

  const testHosts = [];
  for (const name of ["TEST_DATABASE_URL", "TEST_DIRECT_URL"]) {
    if (!env[name]) continue;
    try {
      testHosts.push(hostKey(env[name]));
    } catch {
      return `${name} is not a valid connection string.`;
    }
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"].filter((key) => env[key])) {
    let url;
    try {
      url = new URL(env[name]);
    } catch {
      return `${name} is not a valid connection string.`;
    }
    const host = hostKey(url.hostname);
    if (host === hostKey(production)) return `${name} uses the production database host.`;
    if (testHosts.includes(host)) return `${name} uses the test database host.`;
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (database !== HANDTEST_DATABASE) {
      return `${name} must name the database ${HANDTEST_DATABASE}, not ${database || "(none)"}.`;
    }
  }

  const domain = env.AUTH_ALLOWED_EMAIL_DOMAIN?.trim() ?? "";
  if (!isFakeEmailDomain(domain)) {
    return `AUTH_ALLOWED_EMAIL_DOMAIN (${domain || "unset"}) is not a reserved example domain such as avanza.example.`;
  }
  return null;
}

export function assertHandtestDatabase(env = process.env) {
  const problem = handtestDatabaseProblem(env);
  if (problem) {
    console.error(`Refusing to run: ${problem}`);
    process.exit(1);
  }
}

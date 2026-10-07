/**
 * Refuses local development and migration commands that point at the production database.
 *
 * When NODE_ENV is not production, DATABASE_URL and DIRECT_URL must not use the host in
 * PRODUCTION_DATABASE_HOST. Production (NODE_ENV=production) may use that host.
 */

export function hostKey(value) {
  const host = value.includes("://") ? new URL(value).hostname : value;
  return host.toLowerCase().replace(/^([^.]+)-pooler\./, "$1.");
}

/** @returns {string | null} a refusal reason, or null when the env may proceed */
export function productionHostProblem(env = process.env) {
  if (env.NODE_ENV === "production") return null;

  const urls = ["DATABASE_URL", "DIRECT_URL"].filter((name) => env[name]);
  if (urls.length === 0) return null;

  const production = env.PRODUCTION_DATABASE_HOST?.trim();
  if (!production) {
    return "PRODUCTION_DATABASE_HOST is not set. Set it to the production database host so local commands can avoid it.";
  }

  for (const name of urls) {
    let host;
    try {
      host = hostKey(env[name]);
    } catch {
      return `${name} is not a valid connection string.`;
    }
    if (host === hostKey(production)) {
      return `${name} uses the production database host. Local development must use the dev branch.`;
    }
  }
  return null;
}

export function assertNotProductionHost(env = process.env) {
  const problem = productionHostProblem(env);
  if (problem) {
    console.error(`Refusing to run: ${problem}`);
    process.exit(1);
  }
}

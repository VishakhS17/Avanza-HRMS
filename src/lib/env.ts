/**
 * Environment access.
 * Missing values do not throw at import time. Call `requireDatabaseUrl()` from data code.
 * Auth settings are read at call time in the auth services so a missing SSO provider
 * does not block the rest of the app.
 */
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  authSecret: process.env.AUTH_SECRET ?? "",
  authUrl: process.env.AUTH_URL ?? "http://localhost:3000",
} as const;

export function requireDatabaseUrl(): string {
  if (!env.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and set it.",
    );
  }

  return env.databaseUrl;
}

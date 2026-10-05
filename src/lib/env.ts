/**
 * Environment access for the app shell.
 * Missing values do not throw at import time, so the UI can run before
 * Postgres or Auth.js is configured. Call `requireDatabaseUrl()` from data code.
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

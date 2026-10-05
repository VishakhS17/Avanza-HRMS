/**
 * Seed skeleton. No rows are inserted until employee data exists.
 * Later steps should write records through getDb() from src/lib/db.ts.
 */
import "dotenv/config";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not set. Nothing to seed.");
    return;
  }

  console.log("Seed skeleton: no records to insert yet.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

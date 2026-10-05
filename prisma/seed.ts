/**
 * Creates the first Super Admin when AUTH_BOOTSTRAP_ADMIN_EMAIL is set.
 * Existing users are left unchanged. Re-running the seed does not reset roles.
 */
import "dotenv/config";
import { getDb } from "@/lib/db";
import { ensureBootstrapAdmin } from "@/lib/services/users";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not set. Nothing to seed.");
    return;
  }

  const message = await ensureBootstrapAdmin();
  console.log(message);
  await getDb().$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

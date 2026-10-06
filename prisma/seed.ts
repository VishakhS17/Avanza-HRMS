/**
 * Creates the first Super Admin when AUTH_BOOTSTRAP_ADMIN_EMAIL is set.
 * Existing users are left unchanged. Re-running the seed does not reset roles.
 * Also inserts Casual, Sick, Earned, and Unpaid leave types when they are missing.
 */
import "dotenv/config";
import { getDb } from "@/lib/db";
import { ensureLeaveCatalog } from "@/lib/services/leave-catalog";
import { ensureBootstrapAdmin } from "@/lib/services/users";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL is not set. Nothing to seed.");
    return;
  }

  const message = await ensureBootstrapAdmin();
  console.log(message);
  console.log(await ensureLeaveCatalog());
  await getDb().$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

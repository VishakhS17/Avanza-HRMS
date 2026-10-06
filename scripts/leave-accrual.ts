import "dotenv/config";
import { getDb } from "@/lib/db";
import { runLeaveAccrual } from "@/lib/services/leave-jobs";

async function main() {
  const result = await runLeaveAccrual();
  console.log(`Leave accrual finished. Credited ${result.credited} row(s).`);
  await getDb().$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

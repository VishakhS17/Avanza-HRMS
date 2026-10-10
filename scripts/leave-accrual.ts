import "dotenv/config";
import { getDb } from "@/lib/db";
import { runLeaveAccrual } from "@/lib/services/leave-jobs";

async function main() {
  const result = await runLeaveAccrual();
  console.log(
    `Leave accrual finished. Credited ${result.credited} row(s). Failed ${result.failures.length} employee step(s).`,
  );
  for (const failure of result.failures) {
    console.error(`${failure.employeeId}: ${failure.message}`);
  }
  await getDb().$disconnect();
  if (result.failures.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

import "dotenv/config";
import { getDb } from "@/lib/db";
import { todayIso } from "@/lib/leave-dates";
import { runLeaveCarryForward } from "@/lib/services/leave-jobs";

function yearFromArgs(argv: string[]): number {
  const flag = argv.indexOf("--year");
  if (flag >= 0) {
    const value = Number(argv[flag + 1]);
    if (!Number.isInteger(value)) {
      throw new Error("Pass --year YYYY for the completed leave year.");
    }
    return value;
  }
  const today = todayIso();
  const month = Number(today.slice(5, 7));
  if (month !== 1) {
    throw new Error("Pass --year YYYY. The previous year is used automatically only in January.");
  }
  return Number(today.slice(0, 4)) - 1;
}

async function main() {
  const year = yearFromArgs(process.argv);
  const result = await runLeaveCarryForward({ year });
  console.log(
    `Carry-forward for ${year} finished. Wrote ${result.written} row(s). Failed ${result.failures.length} employee step(s).`,
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

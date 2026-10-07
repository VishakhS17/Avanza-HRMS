import "dotenv/config";
import { getDb } from "@/lib/db";
import { runAttendanceDaily } from "@/lib/services/attendance";

function dateArg(): string | undefined {
  const index = process.argv.indexOf("--date");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Use --date YYYY-MM-DD.");
  }
  return value;
}

async function main() {
  const result = await runAttendanceDaily({ date: dateArg() });
  const range = result.dates.length ? `${result.dates[0]} to ${result.dates.at(-1)}` : "no dates";
  console.log(
    `Attendance job finished for ${range}. Created ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}, ` +
      `skipped ${result.skipped} (regularized or overridden), deferred ${result.deferred} (shift still open), ` +
      `locked ${result.lockedDates} date(s).`,
  );
  await getDb().$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

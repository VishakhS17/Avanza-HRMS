import Link from "next/link";
import { shiftMonth } from "@/lib/leave-dates";

const linkClassName = "inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm text-foreground";

export function MonthNav({ basePath, month }: { basePath: string; month: string }) {
  return (
    <div className="flex gap-2">
      <Link href={`${basePath}?month=${shiftMonth(month, -1)}`} className={linkClassName}>
        Previous
      </Link>
      <Link href={`${basePath}?month=${shiftMonth(month, 1)}`} className={linkClassName}>
        Next
      </Link>
    </div>
  );
}

export function DateNav({ basePath, date, query = "" }: { basePath: string; date: string; query?: string }) {
  const step = (days: number) => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const suffix = query ? `&${query}` : "";
  return (
    <div className="flex gap-2">
      <Link href={`${basePath}?date=${step(-1)}${suffix}`} className={linkClassName}>
        Previous day
      </Link>
      <Link href={`${basePath}?date=${step(1)}${suffix}`} className={linkClassName}>
        Next day
      </Link>
    </div>
  );
}

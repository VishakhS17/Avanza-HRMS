import { LeaveError } from "@/lib/services/leave-errors";

export const LEAVE_TIME_ZONE = "Asia/Kolkata";

export const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type WeekdayName = (typeof WEEKDAYS)[number];

export type HalfSession = "FIRST" | "SECOND";

export type LeavePortion = "1.00" | "0.50";

export type CountedDay = {
  date: string;
  portion: LeavePortion;
  session: HalfSession | null;
};

const WEEKDAY_BY_UTC: WeekdayName[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

const WEEKDAY_LABELS: Record<WeekdayName, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

export function weekdayLabel(day: WeekdayName): string {
  return WEEKDAY_LABELS[day];
}

export function isWeekdayName(value: string): value is WeekdayName {
  return (WEEKDAYS as readonly string[]).includes(value);
}

export function parseIsoDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new LeaveError("Use a date in YYYY-MM-DD format.");
  }
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new LeaveError("That date is not valid.");
  }
  return date;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatZonedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LEAVE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayIso(now = new Date()): string {
  return formatZonedDate(now);
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function addMonthsIso(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(day, last)));
  return formatIsoDate(result);
}

export function eachDate(from: string, to: string): string[] {
  if (from > to) {
    throw new LeaveError("The end date must be on or after the start date.");
  }
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    if (dates.length > 366) {
      throw new LeaveError("Leave can cover at most 366 days.");
    }
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}

export function weekdayOf(iso: string): WeekdayName {
  return WEEKDAY_BY_UTC[parseIsoDate(iso).getUTCDay()];
}

export function formatDays(value: { toFixed(digits: number): string } | string | number): string {
  const fixed = Number(value).toFixed(2);
  return fixed.replace(/0$/, "").replace(/\.0$/, "");
}

export function shiftMonth(month: string, delta: number): string {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new LeaveError("Choose a month.");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const date = parseIsoDate(`${month}-01`);
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function daysInMonth(month: string): string[] {
  const start = parseIsoDate(`${month}-01`);
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= last; day += 1) {
    days.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  return days;
}

export function countLeaveDays(input: {
  from: string;
  to: string;
  session: HalfSession | null;
  weeklyOff: readonly string[];
  holidayDates: readonly string[];
  excludeWeekends: boolean;
  excludeHolidays: boolean;
  halfDayAllowed: boolean;
}): CountedDay[] {
  if (input.session && input.from !== input.to) {
    throw new LeaveError("A half day must be a single date.");
  }
  if (input.session && !input.halfDayAllowed) {
    throw new LeaveError("This leave type does not allow a half day.");
  }

  const off = new Set(input.weeklyOff);
  const holidays = new Set(input.holidayDates);
  const counted: CountedDay[] = [];
  for (const date of eachDate(input.from, input.to)) {
    if (input.excludeWeekends && off.has(weekdayOf(date))) continue;
    if (input.excludeHolidays && holidays.has(date)) continue;
    counted.push({
      date,
      portion: input.session ? "0.50" : "1.00",
      session: input.session,
    });
  }
  if (counted.length === 0) {
    throw new LeaveError("That range has no working days.");
  }
  return counted;
}

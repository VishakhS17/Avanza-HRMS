import { addDaysIso, formatZonedDate, weekdayOf, type HalfSession } from "@/lib/leave-dates";
import { AttendanceError } from "@/lib/services/attendance-errors";

/** All attendance times are Asia/Kolkata wall clock. India has no daylight saving. */
const IST_OFFSET = "+05:30";

/** A regularization must be requested within this many days of the work date. */
export const REGULARIZATION_WINDOW_DAYS = 7;
/** Month M locks once this day of month M+1 has passed. Only attendance.manage edits a locked month. */
export const LOCK_CUTOFF_DAY = 3;
/** An open check-in can still be closed this long after the shift end (or the check-in, if later). */
export const LATE_CHECK_OUT_MINUTES = 6 * 60;
const MAX_SHIFT_MINUTES = 24 * 60;

export type AttendanceStatusName =
  | "PRESENT"
  | "ABSENT"
  | "HALF_DAY"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKLY_OFF"
  | "WFH"
  | "INCOMPLETE";

export type AttendanceFlagName = "LATE" | "EARLY_EXIT" | "INCOMPLETE";
export type AttendanceModeName = "OFFICE" | "WFH";

export type ShiftRule = {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayHours: number;
  fullDayHours: number;
  earlyCheckInMinutes: number;
};

export type Punch = {
  type: "CHECK_IN" | "CHECK_OUT";
  timestamp: Date;
  mode: AttendanceModeName;
};

/** Effective (approved) leave on the day. portion is 1 for a full day, 0.5 for a half day. */
export type DayLeave = { portion: number; session: HalfSession | null } | null;

export type DailyRecord = {
  status: AttendanceStatusName;
  flags: AttendanceFlagName[];
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  mode: AttendanceModeName | null;
};

export const DEFAULT_SHIFT: ShiftRule & { name: string } = {
  name: "General",
  startTime: "09:30",
  endTime: "18:30",
  graceMinutes: 15,
  halfDayHours: 4,
  fullDayHours: 8,
  earlyCheckInMinutes: 240,
};

export function parseClock(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new AttendanceError("Use a time in HH:mm format.");
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The instant for an Asia/Kolkata date and "HH:mm". */
export function zonedInstant(date: string, clock: string): Date {
  parseClock(clock);
  return new Date(`${date}T${clock}:00${IST_OFFSET}`);
}

export function zonedClock(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/** A night shift ends on the calendar day after it starts. */
export function isOvernight(shift: Pick<ShiftRule, "startTime" | "endTime">): boolean {
  return parseClock(shift.endTime) <= parseClock(shift.startTime);
}

/** Start and end instants of the shift whose work date is `workDate` (the day it starts). */
export function shiftBounds(workDate: string, shift: Pick<ShiftRule, "startTime" | "endTime">) {
  const start = zonedInstant(workDate, shift.startTime);
  const endDate = isOvernight(shift) ? addDaysIso(workDate, 1) : workDate;
  return { start, end: zonedInstant(endDate, shift.endTime) };
}

function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000);
}

function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

/**
 * Work date for a check-in. It belongs to the shift whose window
 * [start - earlyCheckInMinutes, end] contains it, so a night-shift check-in at
 * 02:00 stays on the previous day. Outside every window it falls back to the
 * calendar date, which is all a day shift ever needs.
 */
export function workDateForCheckIn(at: Date, shift: ShiftRule): string {
  const calendar = formatZonedDate(at);
  for (const candidate of [addDaysIso(calendar, -1), calendar, addDaysIso(calendar, 1)]) {
    const { start, end } = shiftBounds(candidate, shift);
    if (at >= addMinutes(start, -shift.earlyCheckInMinutes) && at <= end) {
      return candidate;
    }
  }
  return calendar;
}

/** Last moment an open check-in on `workDate` can be closed by a check-out. */
export function checkOutDeadline(workDate: string, checkIn: Date, shift: ShiftRule): Date {
  const { end } = shiftBounds(workDate, shift);
  const base = checkIn > end ? checkIn : end;
  return addMinutes(base, LATE_CHECK_OUT_MINUTES);
}

/**
 * The work date a check-out closes, or null when nothing is open.
 * A check-out after midnight closes the previous work date's night-shift check-in
 * instead of starting a new day.
 */
export function workDateForCheckOut(
  open: { workDate: string; timestamp: Date } | null,
  at: Date,
  shift: ShiftRule,
): string | null {
  if (!open || at < open.timestamp) return null;
  return at <= checkOutDeadline(open.workDate, open.timestamp, shift) ? open.workDate : null;
}

/** The nightly job waits until a day can no longer change through normal punches. */
export function dayIsSettled(workDate: string, shift: ShiftRule, now: Date): boolean {
  const { end } = shiftBounds(workDate, shift);
  return now > addMinutes(end, LATE_CHECK_OUT_MINUTES);
}

export function isMonthLocked(workDate: string, today: string): boolean {
  const [year, month] = workDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, LOCK_CUTOFF_DAY));
  const cutoff = next.toISOString().slice(0, 10);
  return today > cutoff;
}

export function isWithinRegularizationWindow(workDate: string, today: string): boolean {
  return workDate <= today && addDaysIso(workDate, REGULARIZATION_WINDOW_DAYS) >= today;
}

/**
 * Requested times for a regularization. In must be on the work date. Out must be
 * later, the same day for a day shift or up to the next day for a night shift,
 * within 24 hours, and not in the future.
 */
export function validateRegularizationTimes(input: {
  workDate: string;
  requestedIn: Date;
  requestedOut: Date;
  shift: ShiftRule;
  now: Date;
}) {
  const { workDate, requestedIn, requestedOut, shift, now } = input;
  if (Number.isNaN(requestedIn.getTime()) || Number.isNaN(requestedOut.getTime())) {
    throw new AttendanceError("Enter a check-in and check-out time.");
  }
  if (requestedOut <= requestedIn) {
    throw new AttendanceError("Check-out must be after check-in.");
  }
  if (formatZonedDate(requestedIn) !== workDate) {
    throw new AttendanceError("Check-in must be on the work date.");
  }
  const outDate = formatZonedDate(requestedOut);
  const allowedOut = isOvernight(shift) ? [workDate, addDaysIso(workDate, 1)] : [workDate];
  if (!allowedOut.includes(outDate)) {
    throw new AttendanceError(
      isOvernight(shift)
        ? "Check-out must be on the work date or the next morning."
        : "Check-out must be on the work date.",
    );
  }
  if (minutesBetween(requestedIn, requestedOut) > MAX_SHIFT_MINUTES) {
    throw new AttendanceError("A day cannot be longer than 24 hours.");
  }
  if (requestedOut > now) {
    throw new AttendanceError("You cannot enter a time in the future.");
  }
}

/**
 * Derives one day's attendance. Order: holiday, weekly off, approved leave, punches.
 * Worked time runs from the first check-in to the last check-out.
 * `events` must already be the punches assigned to `workDate`.
 */
export function computeDailyRecord(input: {
  workDate: string;
  events: readonly Punch[];
  shift: ShiftRule;
  weeklyOff: readonly string[];
  holidayDates: readonly string[];
  leave: DayLeave;
}): DailyRecord {
  const events = [...input.events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const checkIns = events.filter((event) => event.type === "CHECK_IN");
  const checkOuts = events.filter((event) => event.type === "CHECK_OUT");
  const firstIn = checkIns[0]?.timestamp ?? null;
  const lastOut = checkOuts.at(-1)?.timestamp ?? null;
  const workedMinutes =
    firstIn && lastOut && lastOut > firstIn ? minutesBetween(firstIn, lastOut) : 0;
  const mode = checkIns[0]?.mode ?? null;
  const base = { firstIn, lastOut, workedMinutes, mode };

  if (input.holidayDates.includes(input.workDate)) {
    return { ...base, status: "HOLIDAY", flags: [] };
  }
  if (input.weeklyOff.includes(weekdayOf(input.workDate))) {
    return { ...base, status: "WEEKLY_OFF", flags: [] };
  }

  const leavePortion = input.leave?.portion ?? 0;
  if (leavePortion >= 1) {
    return { ...base, status: "ON_LEAVE", flags: [] };
  }
  if (events.length === 0) {
    return { ...base, status: "ABSENT", flags: [] };
  }

  const halfMinutes = Math.round(input.shift.halfDayHours * 60);
  const fullMinutes = Math.round(input.shift.fullDayHours * 60);
  const missingPunch = events[0].type !== "CHECK_IN" || events.at(-1)?.type !== "CHECK_OUT";

  if (leavePortion > 0) {
    if (missingPunch) return { ...base, status: "INCOMPLETE", flags: ["INCOMPLETE"] };
    return { ...base, status: workedMinutes >= halfMinutes ? "HALF_DAY" : "ABSENT", flags: [] };
  }

  const { start, end } = shiftBounds(input.workDate, input.shift);
  const flags: AttendanceFlagName[] = [];
  if (firstIn && firstIn > addMinutes(start, input.shift.graceMinutes)) flags.push("LATE");
  if (!missingPunch && lastOut && lastOut < end) flags.push("EARLY_EXIT");
  if (missingPunch) {
    flags.push("INCOMPLETE");
    return { ...base, status: "INCOMPLETE", flags };
  }

  if (workedMinutes >= fullMinutes) {
    return { ...base, status: mode === "WFH" ? "WFH" : "PRESENT", flags };
  }
  if (workedMinutes >= halfMinutes) {
    return { ...base, status: "HALF_DAY", flags };
  }
  return { ...base, status: "ABSENT", flags };
}

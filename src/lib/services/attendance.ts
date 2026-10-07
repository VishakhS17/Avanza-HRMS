import { Prisma, type AttendanceRecord, type Shift } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  addDaysIso,
  daysInMonth,
  eachDate,
  formatIsoDate,
  formatZonedDate,
  parseIsoDate,
  todayIso,
} from "@/lib/leave-dates";
import { can, type Principal } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { assertCanDecide, createNotification, resolveApprover } from "@/lib/services/approvals";
import { AttendanceError } from "@/lib/services/attendance-errors";
import {
  DEFAULT_SHIFT,
  checkOutDeadline,
  computeDailyRecord,
  dayIsSettled,
  isMonthLocked,
  isOvernight,
  isWithinRegularizationWindow,
  parseClock,
  validateRegularizationTimes,
  workDateForCheckIn,
  workDateForCheckOut,
  zonedClock,
  zonedInstant,
  type AttendanceFlagName,
  type AttendanceModeName,
  type AttendanceStatusName,
  type DailyRecord,
  type DayLeave,
  type Punch,
  type ShiftRule,
} from "@/lib/services/attendance-rules";
import { AUDIT_ACTIONS, audit, type AuditDb } from "@/lib/services/audit";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { lockApproval, lockEmployee } from "@/lib/services/leave-ledger";
import { deliverMail, type MailMessage } from "@/lib/services/mail";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export const REGULARIZATION_APPROVAL = "ATTENDANCE_REGULARIZATION";
const REGULARIZATION_TARGET = "AttendanceRegularization";
const EFFECTIVE_LEAVE = ["APPROVED", "CANCELLATION_PENDING"] as const;
const OPEN_EMPLOYEE = ["ACTIVE", "NOTICE"] as const;
const PROBLEM_STATUSES: ReadonlySet<AttendanceStatusName> = new Set(["ABSENT", "INCOMPLETE", "HALF_DAY"]);
export const ATTENDANCE_STATUSES: readonly AttendanceStatusName[] = [
  "PRESENT",
  "WFH",
  "HALF_DAY",
  "ABSENT",
  "INCOMPLETE",
  "ON_LEAVE",
  "HOLIDAY",
  "WEEKLY_OFF",
];

type StoredPunch = Punch & { id: string; workDate: string; ipAddress: string | null };

type DayContext = {
  employeeId: string;
  name: string;
  employeeCode: string;
  departmentName: string;
  locationId: string;
  locationName: string;
  rule: ShiftRule;
  weeklyOff: string[];
  holidayDates: string[];
  holidayName: string | null;
  leave: DayLeave;
  leaveTypes: string[];
  events: StoredPunch[];
};

export type PunchView = {
  type: "CHECK_IN" | "CHECK_OUT";
  date: string;
  time: string;
  mode: AttendanceModeName;
  ipAddress: string | null;
};

export type RegularizationView = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  requestedIn: string;
  requestedOut: string;
  reason: string;
  createdAt: string;
};

export type AttendanceDayView = {
  date: string;
  status: AttendanceStatusName | null;
  flags: AttendanceFlagName[];
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  mode: AttendanceModeName | null;
  /** True when no stored record exists yet and the status is worked out from punches. */
  provisional: boolean;
  isToday: boolean;
  isFuture: boolean;
  locked: boolean;
  regularized: boolean;
  overridden: boolean;
  overrideReason: string | null;
  holidayName: string | null;
  leaveTypes: string[];
  punches: PunchView[];
  regularizations: RegularizationView[];
  canRegularize: boolean;
};

export type DailyAttendanceRow = {
  employeeId: string;
  name: string;
  employeeCode: string;
  department: string;
  location: string;
  status: AttendanceStatusName | null;
  flags: AttendanceFlagName[];
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  mode: AttendanceModeName | null;
  provisional: boolean;
  regularized: boolean;
  overridden: boolean;
  overrideReason: string | null;
};

export type AttendanceInboxItem = {
  id: string;
  requesterName: string;
  workDate: string;
  requestedIn: string;
  requestedOut: string;
  reason: string;
  current: { status: AttendanceStatusName; firstIn: string | null; lastOut: string | null } | null;
  punches: PunchView[];
};

export type ShiftView = {
  locationId: string;
  locationName: string;
  isActive: boolean;
  shiftId: string | null;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayHours: string;
  fullDayHours: string;
  earlyCheckInMinutes: number;
  overnight: boolean;
};

function toRule(shift: Shift | null | undefined): ShiftRule {
  if (!shift) return DEFAULT_SHIFT;
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    graceMinutes: shift.graceMinutes,
    halfDayHours: Number(shift.halfDayHours),
    fullDayHours: Number(shift.fullDayHours),
    earlyCheckInMinutes: shift.earlyCheckInMinutes,
  };
}

function clockOf(value: Date | null): string | null {
  return value ? zonedClock(value) : null;
}

function stampLabel(value: Date, workDate: string): string {
  const date = formatZonedDate(value);
  return date === workDate ? zonedClock(value) : `${zonedClock(value)} (${date})`;
}

function requiredReason(value: string, label = "Reason"): string {
  const text = value.trim();
  if (text.length < 1 || text.length > 500) {
    throw new AttendanceError(`${label} must be 1 to 500 characters.`);
  }
  return text;
}

function optionalComment(value: string | undefined, required: boolean): string | null {
  const text = value?.trim() ?? "";
  if (!text && required) throw new AttendanceError("A rejection needs a comment.");
  if (text.length > 500) throw new AttendanceError("Comment must be 500 characters or fewer.");
  return text || null;
}

function parseMode(value: string | undefined): AttendanceModeName {
  if (value === undefined || value === "" || value === "OFFICE") return "OFFICE";
  if (value === "WFH") return "WFH";
  throw new AttendanceError("Choose office or work from home.");
}

function parseMonth(value: string | undefined, today: string): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  return today.slice(0, 7);
}

function toPunch(row: {
  id: string;
  type: "CHECK_IN" | "CHECK_OUT";
  timestamp: Date;
  mode: AttendanceModeName;
  workDate: Date;
  ipAddress: string | null;
}): StoredPunch {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.timestamp,
    mode: row.mode,
    workDate: formatIsoDate(row.workDate),
    ipAddress: row.ipAddress,
  };
}

function punchView(punch: StoredPunch): PunchView {
  return {
    type: punch.type,
    date: formatZonedDate(punch.timestamp),
    time: zonedClock(punch.timestamp),
    mode: punch.mode,
    ipAddress: punch.ipAddress,
  };
}

function snapshot(row: {
  status: AttendanceStatusName;
  flags: readonly AttendanceFlagName[];
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  mode: AttendanceModeName | null;
  locationId?: string | null;
  regularizationId?: string | null;
  overriddenById?: string | null;
}) {
  return {
    status: row.status,
    flags: [...row.flags],
    firstIn: row.firstIn?.toISOString() ?? null,
    lastOut: row.lastOut?.toISOString() ?? null,
    workedMinutes: row.workedMinutes,
    mode: row.mode,
    locationId: row.locationId ?? null,
    regularizationId: row.regularizationId ?? null,
    overriddenById: row.overriddenById ?? null,
  };
}

function sameResult(existing: AttendanceRecord, result: DailyRecord, locationId: string): boolean {
  const before = snapshot(existing);
  const after = snapshot({ ...result, locationId });
  return (
    before.status === after.status &&
    before.flags.join(",") === after.flags.join(",") &&
    before.firstIn === after.firstIn &&
    before.lastOut === after.lastOut &&
    before.workedMinutes === after.workedMinutes &&
    before.mode === after.mode &&
    before.locationId === after.locationId
  );
}

/**
 * Everything computeDailyRecord needs for one date. Only employees in scope on
 * that date: joined on or before it, not pre-joining, and not exited before it.
 * Location comes from the employment row that covered the date.
 */
async function loadDayContexts(
  db: AuditDb,
  date: string,
  filter: { employeeIds?: readonly string[]; locationId?: string } = {},
): Promise<DayContext[]> {
  if (filter.employeeIds && filter.employeeIds.length === 0) return [];
  const day = parseIsoDate(date);
  const employments = await db.employment.findMany({
    where: {
      startDate: { lte: day },
      OR: [{ endDate: null }, { endDate: { gte: day } }],
      ...(filter.employeeIds ? { employeeId: { in: [...filter.employeeIds] } } : {}),
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      employee: {
        joiningDate: { lte: day },
        status: { not: "PRE_JOINING" },
        OR: [{ status: { not: "EXITED" } }, { exitDate: { gte: day } }],
      },
    },
    orderBy: { startDate: "desc" },
    include: {
      employee: { select: { name: true, employeeCode: true } },
      department: { select: { name: true } },
      location: { include: { shift: true } },
    },
  });
  const jobs = new Map<string, (typeof employments)[number]>();
  for (const job of employments) {
    if (!jobs.has(job.employeeId)) jobs.set(job.employeeId, job);
  }
  if (jobs.size === 0) return [];
  const employeeIds = [...jobs.keys()];
  const locationIds = [...new Set([...jobs.values()].map((job) => job.locationId))];

  const holidays = await db.holiday.findMany({
    where: { date: day, isActive: true, locationId: { in: locationIds } },
  });
  const leaveDays = await db.leaveRequestDay.findMany({
    where: {
      employeeId: { in: employeeIds },
      date: day,
      leaveRequest: { status: { in: [...EFFECTIVE_LEAVE] } },
    },
    include: { leaveRequest: { select: { leaveType: { select: { name: true } } } } },
  });
  const events = await db.attendanceEvent.findMany({
    where: { employeeId: { in: employeeIds }, workDate: day },
    orderBy: { timestamp: "asc" },
  });

  const holidayByLocation = new Map(holidays.map((row) => [row.locationId, row.name]));
  const contexts: DayContext[] = [];
  for (const [employeeId, job] of jobs) {
    const leaveRows = leaveDays.filter((row) => row.employeeId === employeeId);
    const portion = leaveRows.reduce((sum, row) => sum + Number(row.portion), 0);
    const holidayName = holidayByLocation.get(job.locationId) ?? null;
    contexts.push({
      employeeId,
      name: job.employee.name,
      employeeCode: job.employee.employeeCode,
      departmentName: job.department.name,
      locationId: job.locationId,
      locationName: job.location.name,
      rule: toRule(job.location.shift),
      weeklyOff: job.location.weeklyOff,
      holidayDates: holidayName ? [date] : [],
      holidayName,
      leave: portion > 0 ? { portion, session: leaveRows.length === 1 ? leaveRows[0].session : null } : null,
      leaveTypes: [...new Set(leaveRows.map((row) => row.leaveRequest.leaveType.name))],
      events: events.filter((row) => row.employeeId === employeeId).map(toPunch),
    });
  }
  return contexts.sort((a, b) => a.name.localeCompare(b.name));
}

function computeFor(date: string, ctx: DayContext, events: readonly Punch[] = ctx.events): DailyRecord {
  return computeDailyRecord({
    workDate: date,
    events,
    shift: ctx.rule,
    weeklyOff: ctx.weeklyOff,
    holidayDates: ctx.holidayDates,
    leave: ctx.leave,
  });
}

async function saveComputed(
  tx: Prisma.TransactionClient,
  input: {
    employeeId: string;
    workDate: string;
    locationId: string;
    result: DailyRecord;
    existing: AttendanceRecord | null;
    actorId: string | null;
    reason?: string | null;
    meta?: AuditMeta;
  },
): Promise<"created" | "updated" | "unchanged"> {
  const { existing, result } = input;
  if (existing && sameResult(existing, result, input.locationId)) return "unchanged";
  const data = {
    status: result.status,
    flags: result.flags,
    firstIn: result.firstIn,
    lastOut: result.lastOut,
    workedMinutes: result.workedMinutes,
    mode: result.mode,
    locationId: input.locationId,
    computedAt: new Date(),
  };
  const row = existing
    ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
    : await tx.attendanceRecord.create({
        data: { ...data, employeeId: input.employeeId, workDate: parseIsoDate(input.workDate) },
      });
  await audit.log(
    {
      actor: input.actorId,
      action: AUDIT_ACTIONS.ATTENDANCE_RECORDED,
      entityType: "AttendanceRecord",
      entityId: row.id,
      before: existing ? { workDate: input.workDate, ...snapshot(existing) } : null,
      after: { workDate: input.workDate, employeeId: input.employeeId, ...snapshot(row) },
      reason: input.reason,
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
    },
    tx,
  );
  return existing ? "updated" : "created";
}

async function currentJob(db: AuditDb, employeeId: string) {
  return db.employment.findFirst({
    where: { employeeId, endDate: null },
    include: { location: { include: { shift: true } } },
  });
}

async function requireManage(actorId: string): Promise<Principal> {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "attendance.manage")) {
    throw new EmployeeAccessError("forbidden", "You cannot manage attendance.");
  }
  return actor;
}

// ---------------------------------------------------------------------------
// Punches

export type PunchStatus = {
  canPunch: boolean;
  message: string | null;
  checkedIn: boolean;
  workDate: string;
  shift: { name: string; startTime: string; endTime: string } | null;
  punches: PunchView[];
};

export async function getPunchStatus(actorId: string): Promise<PunchStatus> {
  await requireActiveActor(actorId);
  const now = new Date();
  const employee = await getDb().employee.findUnique({ where: { id: actorId }, select: { status: true } });
  const job = await currentJob(getDb(), actorId);
  if (!employee || !job || !OPEN_EMPLOYEE.includes(employee.status as (typeof OPEN_EMPLOYEE)[number])) {
    return {
      canPunch: false,
      message: "Check-in needs an active employee record with a current job.",
      checkedIn: false,
      workDate: todayIso(now),
      shift: null,
      punches: [],
    };
  }
  const rule = toRule(job.location.shift);
  const last = await getDb().attendanceEvent.findFirst({
    where: { employeeId: actorId },
    orderBy: [{ timestamp: "desc" }, { createdAt: "desc" }],
  });
  const open =
    last?.type === "CHECK_IN" && now <= checkOutDeadline(formatIsoDate(last.workDate), last.timestamp, rule)
      ? last
      : null;
  const workDate = open ? formatIsoDate(open.workDate) : workDateForCheckIn(now, rule);
  const punches = await getDb().attendanceEvent.findMany({
    where: { employeeId: actorId, workDate: parseIsoDate(workDate) },
    orderBy: { timestamp: "asc" },
  });
  return {
    canPunch: true,
    message: null,
    checkedIn: Boolean(open),
    workDate,
    shift: {
      name: job.location.shift?.name ?? DEFAULT_SHIFT.name,
      startTime: rule.startTime,
      endTime: rule.endTime,
    },
    punches: punches.map((row) => punchView(toPunch(row))),
  };
}

/**
 * Check-in or check-out at the server clock. The client never sends a time, so
 * punches cannot be backdated. One employee's punches are serialized by a row lock.
 */
export async function recordPunch(input: {
  actorId: string;
  type: "CHECK_IN" | "CHECK_OUT";
  mode?: string;
  meta?: AuditMeta;
}) {
  await requireActiveActor(input.actorId);
  if (input.type !== "CHECK_IN" && input.type !== "CHECK_OUT") {
    throw new AttendanceError("Choose check in or check out.");
  }
  const mode = parseMode(input.mode);
  const employee = await getDb().employee.findUnique({
    where: { id: input.actorId },
    select: { status: true, joiningDate: true },
  });
  if (!employee || !OPEN_EMPLOYEE.includes(employee.status as (typeof OPEN_EMPLOYEE)[number])) {
    throw new AttendanceError("Only active employees can record attendance.");
  }

  return getDb().$transaction(async (tx) => {
    await lockEmployee(tx, input.actorId);
    const now = new Date();
    const job = await currentJob(tx, input.actorId);
    if (!job) throw new AttendanceError("You need a current job record before checking in.");
    const rule = toRule(job.location.shift);
    const last = await tx.attendanceEvent.findFirst({
      where: { employeeId: input.actorId },
      orderBy: [{ timestamp: "desc" }, { createdAt: "desc" }],
    });

    let workDate: string;
    let eventMode = mode;
    if (input.type === "CHECK_IN") {
      workDate = workDateForCheckIn(now, rule);
      if (last?.type === "CHECK_IN" && formatIsoDate(last.workDate) === workDate) {
        throw new AttendanceError("You are already checked in.");
      }
      if (workDate < formatIsoDate(employee.joiningDate)) {
        throw new AttendanceError("You cannot check in before your joining date.");
      }
    } else {
      const open =
        last?.type === "CHECK_IN" ? { workDate: formatIsoDate(last.workDate), timestamp: last.timestamp } : null;
      const closes = workDateForCheckOut(open, now, rule);
      if (!closes || !last) throw new AttendanceError("You are not checked in.");
      workDate = closes;
      eventMode = last.mode;
    }

    const event = await tx.attendanceEvent.create({
      data: {
        employeeId: input.actorId,
        workDate: parseIsoDate(workDate),
        type: input.type,
        timestamp: now,
        source: "WEB",
        mode: eventMode,
        ipAddress: input.meta?.ipAddress?.slice(0, 64) ?? null,
      },
    });
    await audit.log(
      {
        actor: input.actorId,
        action: input.type === "CHECK_IN" ? AUDIT_ACTIONS.ATTENDANCE_CHECKED_IN : AUDIT_ACTIONS.ATTENDANCE_CHECKED_OUT,
        entityType: "AttendanceEvent",
        entityId: event.id,
        before: null,
        after: { type: event.type, workDate, timestamp: event.timestamp.toISOString(), mode: event.mode },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    return { id: event.id, workDate, timestamp: event.timestamp };
  });
}

// ---------------------------------------------------------------------------
// Daily records

export type AttendanceJobSummary = {
  dates: string[];
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  deferred: number;
  lockedDates: number;
};

/**
 * Nightly job. Without `date` it catches up from the latest stored work date
 * through yesterday, so a missed night is filled in on the next run. Running it
 * again changes nothing. Regularized, overridden, and locked-month days are left alone.
 * A day whose check-out window is still open (a night shift ending this morning) waits for the next run.
 */
export async function runAttendanceDaily(input: { now?: Date; date?: string } = {}): Promise<AttendanceJobSummary> {
  const now = input.now ?? new Date();
  const today = todayIso(now);
  const yesterday = addDaysIso(today, -1);
  let dates: string[];
  if (input.date) {
    parseIsoDate(input.date);
    if (input.date >= today) throw new AttendanceError("The job only computes days before today.");
    dates = [input.date];
  } else {
    const latest = await getDb().attendanceRecord.aggregate({ _max: { workDate: true } });
    const last = latest._max.workDate ? formatIsoDate(latest._max.workDate) : yesterday;
    dates = eachDate(last < yesterday ? last : yesterday, yesterday);
  }

  const summary: AttendanceJobSummary = {
    dates,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    deferred: 0,
    lockedDates: 0,
  };
  for (const date of dates) {
    if (isMonthLocked(date, today)) {
      summary.lockedDates += 1;
      continue;
    }
    const contexts = await loadDayContexts(getDb(), date);
    for (const ctx of contexts) {
      if (!dayIsSettled(date, ctx.rule, now)) {
        summary.deferred += 1;
        continue;
      }
      const outcome = await getDb().$transaction(async (tx) => {
        await lockEmployee(tx, ctx.employeeId);
        const existing = await tx.attendanceRecord.findUnique({
          where: { employeeId_workDate: { employeeId: ctx.employeeId, workDate: parseIsoDate(date) } },
        });
        if (existing && (existing.regularizationId || existing.overriddenById)) return "skipped" as const;
        const [fresh] = await loadDayContexts(tx, date, { employeeIds: [ctx.employeeId] });
        if (!fresh) return "skipped" as const;
        return saveComputed(tx, {
          employeeId: ctx.employeeId,
          workDate: date,
          locationId: fresh.locationId,
          result: computeFor(date, fresh),
          existing,
          actorId: null,
        });
      });
      summary[outcome] += 1;
    }
  }
  return summary;
}

/**
 * Recomputes stored records after leave or a holiday changes. Today and later
 * are skipped (the job will compute them), as are regularized, overridden, and locked-month records.
 */
export async function recomputeAttendance(
  tx: Prisma.TransactionClient,
  input: {
    dates: readonly string[];
    employeeIds?: readonly string[];
    locationId?: string;
    actorId: string | null;
    reason: string;
    meta?: AuditMeta;
    now?: Date;
  },
): Promise<number> {
  const today = todayIso(input.now);
  let changed = 0;
  for (const date of [...new Set(input.dates)].sort()) {
    if (date >= today || isMonthLocked(date, today)) continue;
    const records = await tx.attendanceRecord.findMany({
      where: {
        workDate: parseIsoDate(date),
        regularizationId: null,
        overriddenById: null,
        ...(input.employeeIds ? { employeeId: { in: [...input.employeeIds] } } : {}),
        ...(input.locationId ? { locationId: input.locationId } : {}),
      },
    });
    if (records.length === 0) continue;
    const contexts = await loadDayContexts(tx, date, { employeeIds: records.map((row) => row.employeeId) });
    const byEmployee = new Map(contexts.map((ctx) => [ctx.employeeId, ctx]));
    for (const record of records) {
      const ctx = byEmployee.get(record.employeeId);
      if (!ctx) continue;
      const outcome = await saveComputed(tx, {
        employeeId: record.employeeId,
        workDate: date,
        locationId: ctx.locationId,
        result: computeFor(date, ctx),
        existing: record,
        actorId: input.actorId,
        reason: input.reason,
        meta: input.meta,
      });
      if (outcome !== "unchanged") changed += 1;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Regularization

function requestedTimes(workDate: string, inTime: string, outTime: string, rule: ShiftRule) {
  const inMinutes = parseClock(inTime);
  const outMinutes = parseClock(outTime);
  const outDate = isOvernight(rule) && outMinutes <= inMinutes ? addDaysIso(workDate, 1) : workDate;
  return {
    requestedIn: zonedInstant(workDate, inTime),
    requestedOut: zonedInstant(outDate, outTime),
  };
}

function lockedFor(actor: Principal, workDate: string, today: string): boolean {
  return isMonthLocked(workDate, today) && !can(actor, "attendance.manage");
}

export async function submitRegularization(input: {
  actorId: string;
  workDate: string;
  inTime: string;
  outTime: string;
  reason: string;
  meta?: AuditMeta;
  now?: Date;
}) {
  const actor = await requireActiveActor(input.actorId);
  const now = input.now ?? new Date();
  const today = todayIso(now);
  parseIsoDate(input.workDate);
  const workDate = input.workDate;
  const reason = requiredReason(input.reason);
  if (!isWithinRegularizationWindow(workDate, today)) {
    throw new AttendanceError("You can regularize a day for up to 7 days after it.");
  }
  if (lockedFor(actor, workDate, today)) {
    throw new AttendanceError("That month is locked. Ask HR to correct it.");
  }
  const [ctx] = await loadDayContexts(getDb(), workDate, { employeeIds: [actor.id] });
  if (!ctx) throw new AttendanceError("You were not employed on that date.");
  const { requestedIn, requestedOut } = requestedTimes(workDate, input.inTime, input.outTime, ctx.rule);
  validateRegularizationTimes({ workDate, requestedIn, requestedOut, shift: ctx.rule, now });

  const outcome = await getDb().$transaction(async (tx) => {
    await lockEmployee(tx, actor.id);
    const pendingKey = `${actor.id}:${workDate}`;
    const pending = await tx.attendanceRegularization.findUnique({ where: { pendingKey } });
    if (pending) throw new AttendanceError("You already have a pending regularization for that day.");
    const approverId = await resolveApprover(tx, actor.id);
    const regularization = await tx.attendanceRegularization.create({
      data: {
        employeeId: actor.id,
        workDate: parseIsoDate(workDate),
        requestedIn,
        requestedOut,
        reason,
        status: "PENDING",
        pendingKey,
      },
    });
    const approval = await tx.approvalRequest.create({
      data: {
        type: REGULARIZATION_APPROVAL,
        targetType: REGULARIZATION_TARGET,
        targetId: regularization.id,
        requesterId: actor.id,
        approverId,
        status: "PENDING",
      },
    });
    const after = {
      workDate,
      requestedIn: requestedIn.toISOString(),
      requestedOut: requestedOut.toISOString(),
      status: "PENDING",
      approverId,
    };
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.ATTENDANCE_REGULARIZATION_REQUESTED,
        entityType: "AttendanceRegularization",
        entityId: regularization.id,
        before: null,
        after,
        reason,
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.ATTENDANCE_REGULARIZATION_REQUESTED,
        entityType: "ApprovalRequest",
        entityId: approval.id,
        before: null,
        after: { status: "PENDING", type: REGULARIZATION_APPROVAL, approverId },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    const label = `${workDate}, ${zonedClock(requestedIn)} to ${stampLabel(requestedOut, workDate)}`;
    const body = `${actor.name || "An employee"} asked to regularize ${label}.`;
    await createNotification(tx, { userId: approverId, title: "Attendance regularization", body, href: "/inbox" });
    const approver = await tx.user.findUnique({ where: { id: approverId }, select: { email: true } });
    const mail: MailMessage[] = approver
      ? [{ to: approver.email, subject: "Attendance regularization requested", text: body }]
      : [];
    return { id: regularization.id, mail };
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AttendanceError("You already have a pending regularization for that day.");
    }
    throw error;
  });

  await deliverMail(outcome.mail);
  return { id: outcome.id };
}

/**
 * Approve or reject a regularization. Approval rewrites the day's record from
 * the requested times. The original punches are not touched.
 * A month that locked while the request waited can only be approved by HR.
 */
export async function decideRegularization(input: {
  actorId: string;
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  comment?: string;
  meta?: AuditMeta;
  now?: Date;
}) {
  if (input.decision !== "APPROVED" && input.decision !== "REJECTED") {
    throw new AttendanceError("Choose approve or reject.");
  }
  const comment = optionalComment(input.comment, input.decision === "REJECTED");
  const actor = await requireActiveActor(input.actorId);
  const today = todayIso(input.now ?? new Date());

  const outcome = await getDb().$transaction(async (tx) => {
    await lockApproval(tx, input.approvalId);
    const approval = await tx.approvalRequest.findUnique({ where: { id: input.approvalId } });
    if (!approval || approval.status !== "PENDING") {
      throw new AttendanceError("That request is not pending.");
    }
    if (approval.type !== REGULARIZATION_APPROVAL || approval.targetType !== REGULARIZATION_TARGET) {
      throw new AttendanceError("That request is not a regularization.");
    }
    await assertCanDecide(tx, actor.id, approval);
    const regularization = await tx.attendanceRegularization.findUnique({ where: { id: approval.targetId } });
    if (!regularization || regularization.status !== "PENDING") {
      throw new AttendanceError("That regularization is not pending.");
    }
    await lockEmployee(tx, regularization.employeeId);
    const workDate = formatIsoDate(regularization.workDate);
    const decidedAt = new Date();

    let recordId: string | null = null;
    if (input.decision === "APPROVED") {
      if (lockedFor(actor, workDate, today)) {
        throw new AttendanceError("That month is locked. Only HR can approve this now.");
      }
      const [ctx] = await loadDayContexts(tx, workDate, { employeeIds: [regularization.employeeId] });
      if (!ctx) throw new AttendanceError("The employee was not employed on that date.");
      const mode = ctx.events.find((event) => event.type === "CHECK_IN")?.mode ?? "OFFICE";
      const result = computeFor(workDate, ctx, [
        { type: "CHECK_IN", timestamp: regularization.requestedIn, mode },
        { type: "CHECK_OUT", timestamp: regularization.requestedOut, mode },
      ]);
      const existing = await tx.attendanceRecord.findUnique({
        where: { employeeId_workDate: { employeeId: regularization.employeeId, workDate: regularization.workDate } },
      });
      const data = {
        status: result.status,
        flags: result.flags,
        firstIn: result.firstIn,
        lastOut: result.lastOut,
        workedMinutes: result.workedMinutes,
        mode: result.mode,
        locationId: ctx.locationId,
        regularizationId: regularization.id,
        overriddenById: null,
        overrideReason: null,
        overriddenAt: null,
        computedAt: decidedAt,
      };
      const record = existing
        ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
        : await tx.attendanceRecord.create({
            data: { ...data, employeeId: regularization.employeeId, workDate: regularization.workDate },
          });
      recordId = record.id;
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.ATTENDANCE_REGULARIZATION_APPROVED,
          entityType: "AttendanceRecord",
          entityId: record.id,
          before: existing ? { workDate, ...snapshot(existing) } : null,
          after: { workDate, employeeId: record.employeeId, ...snapshot(record) },
          reason: comment ?? regularization.reason,
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
    }

    await tx.attendanceRegularization.update({
      where: { id: regularization.id },
      data: { status: input.decision, pendingKey: null, decidedAt },
    });
    await tx.approvalRequest.update({
      where: { id: approval.id },
      data: { status: input.decision, comment, decidedAt },
    });
    const action =
      input.decision === "APPROVED"
        ? AUDIT_ACTIONS.ATTENDANCE_REGULARIZATION_APPROVED
        : AUDIT_ACTIONS.ATTENDANCE_REGULARIZATION_REJECTED;
    for (const [entityType, entityId] of [
      ["AttendanceRegularization", regularization.id],
      ["ApprovalRequest", approval.id],
    ] as const) {
      await audit.log(
        {
          actor: actor.id,
          action,
          entityType,
          entityId,
          before: { status: "PENDING" },
          after: { status: input.decision, ...(recordId ? { recordId } : {}) },
          reason: comment,
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
    }

    const verb = input.decision === "APPROVED" ? "approved" : "rejected";
    const body = `Your regularization for ${workDate} was ${verb}.${comment ? ` Comment: ${comment}` : ""}`;
    await createNotification(tx, {
      userId: regularization.employeeId,
      title: `Regularization ${verb}`,
      body,
      href: `/my-space/attendance?month=${workDate.slice(0, 7)}`,
    });
    const requester = await tx.user.findUnique({ where: { id: regularization.employeeId }, select: { email: true } });
    const mail: MailMessage[] = requester
      ? [{ to: requester.email, subject: `Regularization ${verb}`, text: body }]
      : [];
    return { mail };
  });

  await deliverMail(outcome.mail);
}

export async function loadAttendanceInbox(userId: string): Promise<AttendanceInboxItem[]> {
  const approvals = await getDb().approvalRequest.findMany({
    where: { approverId: userId, status: "PENDING", type: REGULARIZATION_APPROVAL },
    include: { requester: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (approvals.length === 0) return [];
  const regularizations = await getDb().attendanceRegularization.findMany({
    where: { id: { in: approvals.map((approval) => approval.targetId) } },
  });
  const byId = new Map(regularizations.map((row) => [row.id, row]));
  const items: AttendanceInboxItem[] = [];
  for (const approval of approvals) {
    const row = byId.get(approval.targetId);
    if (!row) continue;
    const workDate = formatIsoDate(row.workDate);
    const [record, events] = await Promise.all([
      getDb().attendanceRecord.findUnique({
        where: { employeeId_workDate: { employeeId: row.employeeId, workDate: row.workDate } },
      }),
      getDb().attendanceEvent.findMany({
        where: { employeeId: row.employeeId, workDate: row.workDate },
        orderBy: { timestamp: "asc" },
      }),
    ]);
    items.push({
      id: approval.id,
      requesterName: approval.requester.name,
      workDate,
      requestedIn: stampLabel(row.requestedIn, workDate),
      requestedOut: stampLabel(row.requestedOut, workDate),
      reason: row.reason,
      current: record
        ? { status: record.status, firstIn: clockOf(record.firstIn), lastOut: clockOf(record.lastOut) }
        : null,
      punches: events.map((event) => punchView(toPunch(event))),
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// HR override

export async function overrideAttendance(input: {
  actorId: string;
  employeeId: string;
  workDate: string;
  status: string;
  inTime?: string;
  outTime?: string;
  reason: string;
  meta?: AuditMeta;
}) {
  const actor = await requireManage(input.actorId);
  if (input.employeeId === actor.id) {
    throw new AttendanceError("You cannot override your own attendance.");
  }
  const reason = requiredReason(input.reason);
  parseIsoDate(input.workDate);
  const workDate = input.workDate;
  if (workDate > todayIso()) throw new AttendanceError("You cannot override a future date.");
  if (!(ATTENDANCE_STATUSES as readonly string[]).includes(input.status)) {
    throw new AttendanceError("Choose a status.");
  }
  const status = input.status as AttendanceStatusName;
  const [ctx] = await loadDayContexts(getDb(), workDate, { employeeIds: [input.employeeId] });
  if (!ctx) throw new AttendanceError("That person was not employed on that date.");

  const inTime = input.inTime?.trim() ?? "";
  const outTime = input.outTime?.trim() ?? "";
  let times: { requestedIn: Date; requestedOut: Date } | null = null;
  if (inTime || outTime) {
    if (!inTime || !outTime) throw new AttendanceError("Enter both times, or leave both blank.");
    times = requestedTimes(workDate, inTime, outTime, ctx.rule);
    if (times.requestedOut <= times.requestedIn) throw new AttendanceError("Check-out must be after check-in.");
  }

  await getDb().$transaction(async (tx) => {
    await lockEmployee(tx, input.employeeId);
    const existing = await tx.attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId: input.employeeId, workDate: parseIsoDate(workDate) } },
    });
    const firstIn = times ? times.requestedIn : (existing?.firstIn ?? null);
    const lastOut = times ? times.requestedOut : (existing?.lastOut ?? null);
    const workedMinutes =
      firstIn && lastOut && lastOut > firstIn ? Math.floor((lastOut.getTime() - firstIn.getTime()) / 60_000) : 0;
    const data = {
      status,
      flags: [] as AttendanceFlagName[],
      firstIn,
      lastOut,
      workedMinutes,
      mode: existing?.mode ?? ctx.events.find((event) => event.type === "CHECK_IN")?.mode ?? null,
      locationId: ctx.locationId,
      overriddenById: actor.id,
      overrideReason: reason,
      overriddenAt: new Date(),
      computedAt: new Date(),
    };
    const record = existing
      ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
      : await tx.attendanceRecord.create({
          data: { ...data, employeeId: input.employeeId, workDate: parseIsoDate(workDate) },
        });
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.ATTENDANCE_OVERRIDDEN,
        entityType: "AttendanceRecord",
        entityId: record.id,
        before: existing ? { workDate, ...snapshot(existing) } : null,
        after: { workDate, employeeId: record.employeeId, ...snapshot(record) },
        reason,
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Views

async function monthView(
  employeeId: string,
  month: string,
  viewer: Principal,
  now: Date,
): Promise<AttendanceDayView[]> {
  const db = getDb();
  const today = todayIso(now);
  const dates = daysInMonth(month);
  const from = parseIsoDate(dates[0]);
  const to = parseIsoDate(dates.at(-1)!);
  const job = await currentJob(db, employeeId);
  const rule = toRule(job?.location.shift);
  const weeklyOff = job?.location.weeklyOff ?? [];

  const [records, events, regularizations, holidays, leaveDays, employee] = await Promise.all([
    db.attendanceRecord.findMany({ where: { employeeId, workDate: { gte: from, lte: to } } }),
    db.attendanceEvent.findMany({
      where: { employeeId, workDate: { gte: from, lte: to } },
      orderBy: { timestamp: "asc" },
    }),
    db.attendanceRegularization.findMany({
      where: { employeeId, workDate: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
    }),
    job
      ? db.holiday.findMany({ where: { locationId: job.locationId, isActive: true, date: { gte: from, lte: to } } })
      : Promise.resolve([]),
    db.leaveRequestDay.findMany({
      where: { employeeId, date: { gte: from, lte: to }, leaveRequest: { status: { in: [...EFFECTIVE_LEAVE] } } },
      include: { leaveRequest: { select: { leaveType: { select: { name: true } } } } },
    }),
    db.employee.findUnique({ where: { id: employeeId }, select: { joiningDate: true } }),
  ]);

  const recordByDate = new Map(records.map((row) => [formatIsoDate(row.workDate), row]));
  const holidayByDate = new Map(holidays.map((row) => [formatIsoDate(row.date), row.name]));
  const joined = employee ? formatIsoDate(employee.joiningDate) : today;
  const isSelf = viewer.id === employeeId;

  return dates.map((date) => {
    const punches = events.filter((row) => formatIsoDate(row.workDate) === date).map(toPunch);
    const leaveRows = leaveDays.filter((row) => formatIsoDate(row.date) === date);
    const portion = leaveRows.reduce((sum, row) => sum + Number(row.portion), 0);
    const holidayName = holidayByDate.get(date) ?? null;
    const regs = regularizations.filter((row) => formatIsoDate(row.workDate) === date);
    const record = recordByDate.get(date) ?? null;
    const isToday = date === today;
    const isFuture = date > today;
    const locked = isMonthLocked(date, today);

    let status: AttendanceStatusName | null = null;
    let flags: AttendanceFlagName[] = [];
    let firstIn: Date | null = null;
    let lastOut: Date | null = null;
    let workedMinutes = 0;
    let mode: AttendanceModeName | null = null;
    let provisional = false;
    if (record) {
      ({ status, flags, firstIn, lastOut, workedMinutes, mode } = record);
    } else if (date >= joined) {
      const live = computeDailyRecord({
        workDate: date,
        events: punches,
        shift: rule,
        weeklyOff,
        holidayDates: holidayName ? [date] : [],
        leave: portion > 0 ? { portion, session: leaveRows.length === 1 ? leaveRows[0].session : null } : null,
      });
      ({ firstIn, lastOut, workedMinutes, mode } = live);
      const settled = !isToday && !isFuture && dayIsSettled(date, rule, now);
      if (settled || ["HOLIDAY", "WEEKLY_OFF", "ON_LEAVE"].includes(live.status)) {
        status = live.status;
        flags = live.flags;
        provisional = true;
      }
    }

    const hasPending = regs.some((row) => row.status === "PENDING");
    const problem =
      status !== null && (PROBLEM_STATUSES.has(status) || flags.includes("LATE") || flags.includes("EARLY_EXIT"));
    const canRegularize =
      isSelf &&
      !isFuture &&
      problem &&
      !hasPending &&
      !record?.overriddenById &&
      isWithinRegularizationWindow(date, today) &&
      !lockedFor(viewer, date, today);

    return {
      date,
      status,
      flags,
      firstIn: firstIn ? stampLabel(firstIn, date) : null,
      lastOut: lastOut ? stampLabel(lastOut, date) : null,
      workedMinutes,
      mode,
      provisional,
      isToday,
      isFuture,
      locked,
      regularized: Boolean(record?.regularizationId),
      overridden: Boolean(record?.overriddenById),
      overrideReason: record?.overrideReason ?? null,
      holidayName,
      leaveTypes: [...new Set(leaveRows.map((row) => row.leaveRequest.leaveType.name))],
      punches: punches.map(punchView),
      regularizations: regs.map((row) => ({
        id: row.id,
        status: row.status,
        requestedIn: stampLabel(row.requestedIn, date),
        requestedOut: stampLabel(row.requestedOut, date),
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
      canRegularize,
    };
  });
}

export async function getMyAttendanceMonth(actorId: string, monthParam?: string) {
  const actor = await requireActiveActor(actorId);
  const now = new Date();
  const month = parseMonth(monthParam, todayIso(now));
  const job = await currentJob(getDb(), actor.id);
  return {
    month,
    shift: job
      ? { name: job.location.shift?.name ?? DEFAULT_SHIFT.name, ...toRule(job.location.shift), location: job.location.name }
      : null,
    days: await monthView(actor.id, month, actor, now),
  };
}

export async function getEmployeeAttendanceMonth(actorId: string, employeeId: string, monthParam?: string) {
  const actor = await requireActiveActor(actorId);
  const job = await currentJob(getDb(), employeeId);
  const employee = await getDb().employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, employeeCode: true },
  });
  const allowed =
    employee &&
    (can(actor, "attendance.manage") ||
      (employeeId !== actor.id &&
        can(actor, "team.view") &&
        can(actor, "employee.view", { type: "employee", id: employeeId, managerId: job?.reportingManagerId ?? null })));
  if (!allowed) throw new EmployeeAccessError("not-found", "Employee not found.");
  const now = new Date();
  const month = parseMonth(monthParam, todayIso(now));
  return { employee, month, days: await monthView(employeeId, month, actor, now) };
}

async function dailyRows(
  date: string,
  filter: { employeeIds?: readonly string[]; locationId?: string },
  now: Date,
): Promise<DailyAttendanceRow[]> {
  const today = todayIso(now);
  const contexts = await loadDayContexts(getDb(), date, filter);
  if (contexts.length === 0) return [];
  const records = await getDb().attendanceRecord.findMany({
    where: { workDate: parseIsoDate(date), employeeId: { in: contexts.map((ctx) => ctx.employeeId) } },
  });
  const recordByEmployee = new Map(records.map((row) => [row.employeeId, row]));
  return contexts.map((ctx) => {
    const record = recordByEmployee.get(ctx.employeeId);
    const live = computeFor(date, ctx);
    const settled = date < today && dayIsSettled(date, ctx.rule, now);
    const known = settled || ["HOLIDAY", "WEEKLY_OFF", "ON_LEAVE"].includes(live.status);
    const source = record ?? live;
    return {
      employeeId: ctx.employeeId,
      name: ctx.name,
      employeeCode: ctx.employeeCode,
      department: ctx.departmentName,
      location: ctx.locationName,
      status: record ? record.status : known ? live.status : null,
      flags: record ? record.flags : known ? live.flags : [],
      firstIn: source.firstIn ? stampLabel(source.firstIn, date) : null,
      lastOut: source.lastOut ? stampLabel(source.lastOut, date) : null,
      workedMinutes: source.workedMinutes,
      mode: source.mode,
      provisional: !record,
      regularized: Boolean(record?.regularizationId),
      overridden: Boolean(record?.overriddenById),
      overrideReason: record?.overrideReason ?? null,
    };
  });
}

function parseDate(value: string | undefined, today: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    try {
      parseIsoDate(value);
      return value;
    } catch {
      return today;
    }
  }
  return today;
}

export async function listTeamAttendance(actorId: string, dateParam?: string) {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "team.view")) {
    throw new EmployeeAccessError("forbidden", "You cannot view this team.");
  }
  const now = new Date();
  const date = parseDate(dateParam, todayIso(now));
  const rows = actor.directReportIds.length
    ? await dailyRows(date, { employeeIds: actor.directReportIds }, now)
    : [];
  return { date, rows };
}

export async function listDailyAttendance(
  actorId: string,
  params: { date?: string; locationId?: string; departmentId?: string; status?: string },
) {
  await requireManage(actorId);
  const now = new Date();
  const date = parseDate(params.date, todayIso(now));
  const [locations, departments] = await Promise.all([
    getDb().location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getDb().department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const locationId = locations.some((row) => row.id === params.locationId) ? params.locationId : undefined;
  const department = departments.find((row) => row.id === params.departmentId);
  const status = (ATTENDANCE_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as AttendanceStatusName)
    : undefined;
  let rows = await dailyRows(date, { locationId }, now);
  if (department) rows = rows.filter((row) => row.department === department.name);
  if (status) rows = rows.filter((row) => row.status === status);
  return {
    date,
    locked: isMonthLocked(date, todayIso(now)),
    filters: { locationId: locationId ?? "", departmentId: department?.id ?? "", status: status ?? "" },
    locations,
    departments,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Shifts

export async function createDefaultShift(
  tx: Prisma.TransactionClient,
  input: { locationId: string; actorId: string | null; meta?: AuditMeta },
) {
  const shift = await tx.shift.create({
    data: {
      locationId: input.locationId,
      name: DEFAULT_SHIFT.name,
      startTime: DEFAULT_SHIFT.startTime,
      endTime: DEFAULT_SHIFT.endTime,
      graceMinutes: DEFAULT_SHIFT.graceMinutes,
      halfDayHours: new Prisma.Decimal(DEFAULT_SHIFT.halfDayHours),
      fullDayHours: new Prisma.Decimal(DEFAULT_SHIFT.fullDayHours),
      earlyCheckInMinutes: DEFAULT_SHIFT.earlyCheckInMinutes,
    },
  });
  await audit.log(
    {
      actor: input.actorId,
      action: AUDIT_ACTIONS.SHIFT_CREATED,
      entityType: "Shift",
      entityId: shift.id,
      before: null,
      after: shiftSnapshot(shift),
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
    },
    tx,
  );
  return shift;
}

function shiftSnapshot(shift: Shift) {
  return {
    locationId: shift.locationId,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    graceMinutes: shift.graceMinutes,
    halfDayHours: shift.halfDayHours.toFixed(2),
    fullDayHours: shift.fullDayHours.toFixed(2),
    earlyCheckInMinutes: shift.earlyCheckInMinutes,
  };
}

export async function listShifts(actorId: string): Promise<ShiftView[]> {
  await requireManage(actorId);
  const locations = await getDb().location.findMany({ orderBy: { name: "asc" }, include: { shift: true } });
  return locations.map((location) => {
    const rule = toRule(location.shift);
    return {
      locationId: location.id,
      locationName: location.name,
      isActive: location.isActive,
      shiftId: location.shift?.id ?? null,
      name: location.shift?.name ?? DEFAULT_SHIFT.name,
      startTime: rule.startTime,
      endTime: rule.endTime,
      graceMinutes: rule.graceMinutes,
      halfDayHours: rule.halfDayHours.toFixed(2),
      fullDayHours: rule.fullDayHours.toFixed(2),
      earlyCheckInMinutes: rule.earlyCheckInMinutes,
      overnight: isOvernight(rule),
    };
  });
}

function boundedInt(value: string, label: string, min: number, max: number): number {
  const number = Number(value);
  if (!/^\d+$/.test(value.trim()) || number < min || number > max) {
    throw new AttendanceError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function boundedHours(value: string, label: string): Prisma.Decimal {
  const text = value.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text) || Number(text) <= 0 || Number(text) > 24) {
    throw new AttendanceError(`${label} must be more than 0 and at most 24 hours.`);
  }
  return new Prisma.Decimal(text);
}

/** Changes apply to days computed from now on. Stored records are not recomputed. */
export async function updateShift(input: {
  actorId: string;
  locationId: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: string;
  halfDayHours: string;
  fullDayHours: string;
  earlyCheckInMinutes: string;
  meta?: AuditMeta;
}) {
  const actor = await requireManage(input.actorId);
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40) throw new AttendanceError("Shift name must be 1 to 40 characters.");
  const start = parseClock(input.startTime);
  const end = parseClock(input.endTime);
  if (start === end) throw new AttendanceError("Start and end must differ.");
  const graceMinutes = boundedInt(input.graceMinutes, "Grace minutes", 0, 240);
  const earlyCheckInMinutes = boundedInt(input.earlyCheckInMinutes, "Early check-in minutes", 0, 720);
  const halfDayHours = boundedHours(input.halfDayHours, "Half-day hours");
  const fullDayHours = boundedHours(input.fullDayHours, "Full-day hours");
  if (halfDayHours.greaterThan(fullDayHours)) {
    throw new AttendanceError("Half-day hours cannot be more than full-day hours.");
  }
  const location = await getDb().location.findUnique({ where: { id: input.locationId }, include: { shift: true } });
  if (!location) throw new AttendanceError("That location was not found.");
  const data = {
    name,
    startTime: input.startTime.trim(),
    endTime: input.endTime.trim(),
    graceMinutes,
    halfDayHours,
    fullDayHours,
    earlyCheckInMinutes,
  };
  await getDb().$transaction(async (tx) => {
    const shift = location.shift
      ? await tx.shift.update({ where: { id: location.shift.id }, data })
      : await tx.shift.create({ data: { ...data, locationId: location.id } });
    await audit.log(
      {
        actor: actor.id,
        action: location.shift ? AUDIT_ACTIONS.SHIFT_UPDATED : AUDIT_ACTIONS.SHIFT_CREATED,
        entityType: "Shift",
        entityId: shift.id,
        before: location.shift ? shiftSnapshot(location.shift) : null,
        after: shiftSnapshot(shift),
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
  });
}

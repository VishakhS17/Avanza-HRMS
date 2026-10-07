import type { EmployeeStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  attendanceFlagLabel,
  attendanceStatusLabel,
} from "@/lib/attendance-labels";
import { employeeStatusLabel } from "@/lib/employee-labels";
import {
  addDaysIso,
  daysInMonth,
  parseIsoDate,
  todayIso,
  WEEKDAYS,
  weekdayOf,
} from "@/lib/leave-dates";
import { can, type Principal } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { listAttendanceRowsForEmployees, type DailyAttendanceRow } from "@/lib/services/attendance";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { EmployeeAccessError } from "@/lib/services/employee-errors";

export const REPORT_TYPES = [
  "headcount",
  "attendance-daily",
  "attendance-monthly",
  "leave-balances",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_OPTIONS: { value: ReportType; label: string }[] = [
  { value: "headcount", label: "Headcount" },
  { value: "attendance-daily", label: "Daily attendance" },
  { value: "attendance-monthly", label: "Monthly attendance" },
  { value: "leave-balances", label: "Leave balances" },
];

export const REPORT_GROUP_BY = ["department", "location", "status"] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];

export const REPORT_EXPORT_LIMIT = 5000;

const EMPLOYEE_STATUSES = ["PRE_JOINING", "ACTIVE", "NOTICE", "EXITED"] as const;
const WORKING_STATUSES = ["ACTIVE", "NOTICE"] as const;

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ReportSearch = {
  type: ReportType;
  groupBy: ReportGroupBy;
  departmentId: string;
  locationId: string;
  status: string;
  date: string;
  month: string;
};

export type ReportColumn = { id: string; header: string };

export type ReportRow = Record<string, string>;

export type ReportTable = {
  type: ReportType;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
};

export type ReportFilterOption = { id: string; name: string };

export type ReportPage = {
  search: ReportSearch;
  table: ReportTable;
  departments: ReportFilterOption[];
  locations: ReportFilterOption[];
};

type ScopedEmployee = {
  id: string;
  name: string;
  employeeCode: string;
  status: EmployeeStatus;
  joiningDate: Date;
  exitDate: Date | null;
  departmentId: string;
  departmentName: string;
  locationId: string;
  locationName: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

function isGroupBy(value: string): value is ReportGroupBy {
  return (REPORT_GROUP_BY as readonly string[]).includes(value);
}

function isEmployeeStatus(value: string): value is EmployeeStatus {
  return (EMPLOYEE_STATUSES as readonly string[]).includes(value);
}

function parseMonth(value: string, fallback: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
}

function parseDateParam(value: string, fallback: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  try {
    parseIsoDate(value);
    return value;
  } catch {
    return fallback;
  }
}

export function isCompanyWideReporter(user: Principal): boolean {
  return can(user, "reports.view") && (user.roles.includes("HR_ADMIN") || user.roles.includes("SUPER_ADMIN"));
}

export async function requireReporter(actorId: string): Promise<Principal> {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "reports.view")) {
    throw new EmployeeAccessError("forbidden", "You cannot view reports.");
  }
  return actor;
}

export function parseReportSearch(params: SearchParams, now = new Date()): ReportSearch {
  const today = todayIso(now);
  const typeValue = first(params.type);
  const groupValue = first(params.groupBy);
  const status = first(params.status);
  return {
    type: isReportType(typeValue) ? typeValue : "headcount",
    groupBy: isGroupBy(groupValue) ? groupValue : "department",
    departmentId: first(params.departmentId),
    locationId: first(params.locationId),
    status: isEmployeeStatus(status) ? status : "",
    date: parseDateParam(first(params.date), today),
    month: parseMonth(first(params.month), today.slice(0, 7)),
  };
}

export function reportQueryString(search: ReportSearch): string {
  const params = new URLSearchParams();
  params.set("type", search.type);
  if (search.type === "headcount" && search.groupBy !== "department") params.set("groupBy", search.groupBy);
  if (search.departmentId) params.set("departmentId", search.departmentId);
  if (search.locationId) params.set("locationId", search.locationId);
  if (search.status) params.set("status", search.status);
  if (search.type === "attendance-daily") params.set("date", search.date);
  if (search.type === "attendance-monthly") params.set("month", search.month);
  const value = params.toString();
  return value ? `?${value}` : "";
}

async function scopedEmployees(actor: Principal, filters: {
  departmentId?: string;
  locationId?: string;
  status?: string;
  workingOnly?: boolean;
}): Promise<ScopedEmployee[]> {
  if (!isCompanyWideReporter(actor) && actor.directReportIds.length === 0) {
    return [];
  }
  const statusFilter = filters.status && isEmployeeStatus(filters.status) ? filters.status : undefined;
  const rows = await getDb().employee.findMany({
    where: {
      ...(!isCompanyWideReporter(actor) ? { id: { in: [...actor.directReportIds] } } : {}),
      ...(statusFilter
        ? { status: statusFilter }
        : filters.workingOnly
          ? { status: { in: [...WORKING_STATUSES] } }
          : {}),
      employments: {
        some: {
          endDate: null,
          ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
          ...(filters.locationId ? { locationId: filters.locationId } : {}),
        },
      },
    },
    include: {
      employments: {
        where: { endDate: null },
        include: { department: { select: { id: true, name: true } }, location: { select: { id: true, name: true } } },
        take: 1,
      },
    },
    orderBy: [{ name: "asc" }, { employeeCode: "asc" }],
  });
  return rows.flatMap((row) => {
    const job = row.employments[0];
    if (!job) return [];
    return [
      {
        id: row.id,
        name: row.name,
        employeeCode: row.employeeCode,
        status: row.status,
        joiningDate: row.joiningDate,
        exitDate: row.exitDate,
        departmentId: job.department.id,
        departmentName: job.department.name,
        locationId: job.location.id,
        locationName: job.location.name,
      },
    ];
  });
}

async function filterOptions(actor: Principal): Promise<{
  departments: ReportFilterOption[];
  locations: ReportFilterOption[];
}> {
  const people = await scopedEmployees(actor, {});
  const departments = new Map<string, string>();
  const locations = new Map<string, string>();
  for (const person of people) {
    departments.set(person.departmentId, person.departmentName);
    locations.set(person.locationId, person.locationName);
  }
  return {
    departments: [...departments.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    locations: [...locations.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function headcountTable(people: ScopedEmployee[], groupBy: ReportGroupBy): ReportTable {
  if (groupBy === "status") {
    const counts = new Map<EmployeeStatus, number>();
    for (const status of EMPLOYEE_STATUSES) counts.set(status, 0);
    for (const person of people) {
      counts.set(person.status, (counts.get(person.status) ?? 0) + 1);
    }
    return {
      type: "headcount",
      title: "Headcount by status",
      columns: [
        { id: "status", header: "Status" },
        { id: "count", header: "People" },
      ],
      rows: EMPLOYEE_STATUSES.map((status) => ({
        id: status,
        status: employeeStatusLabel(status),
        count: String(counts.get(status) ?? 0),
      })),
    };
  }

  const keyOf = (person: ScopedEmployee) => (groupBy === "location" ? person.locationId : person.departmentId);
  const labelOf = (person: ScopedEmployee) => (groupBy === "location" ? person.locationName : person.departmentName);
  const groups = new Map<
    string,
    { label: string; PRE_JOINING: number; ACTIVE: number; NOTICE: number; EXITED: number }
  >();
  for (const person of people) {
    const key = keyOf(person);
    const current = groups.get(key) ?? {
      label: labelOf(person),
      PRE_JOINING: 0,
      ACTIVE: 0,
      NOTICE: 0,
      EXITED: 0,
    };
    current[person.status] += 1;
    groups.set(key, current);
  }
  const groupHeader = groupBy === "location" ? "Location" : "Department";
  return {
    type: "headcount",
    title: `Headcount by ${groupBy}`,
    columns: [
      { id: "group", header: groupHeader },
      { id: "active", header: "Active" },
      { id: "notice", header: "Notice" },
      { id: "preJoining", header: "Pre-joining" },
      { id: "exited", header: "Exited" },
      { id: "total", header: "Total" },
    ],
    rows: [...groups.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([id, group]) => {
        const total = group.PRE_JOINING + group.ACTIVE + group.NOTICE + group.EXITED;
        return {
          id,
          group: group.label,
          active: String(group.ACTIVE),
          notice: String(group.NOTICE),
          preJoining: String(group.PRE_JOINING),
          exited: String(group.EXITED),
          total: String(total),
        };
      }),
  };
}

function dailyTable(rows: DailyAttendanceRow[]): ReportTable {
  return {
    type: "attendance-daily",
    title: "Daily attendance",
    columns: [
      { id: "name", header: "Name" },
      { id: "code", header: "Code" },
      { id: "department", header: "Department" },
      { id: "location", header: "Location" },
      { id: "status", header: "Status" },
      { id: "firstIn", header: "In" },
      { id: "lastOut", header: "Out" },
      { id: "flags", header: "Flags" },
    ],
    rows: rows.map((row) => ({
      id: row.employeeId,
      name: row.name,
      code: row.employeeCode,
      department: row.department,
      location: row.location,
      status: row.status ? attendanceStatusLabel(row.status) : "Not recorded",
      firstIn: row.firstIn ?? "—",
      lastOut: row.lastOut ?? "—",
      flags: row.flags.map(attendanceFlagLabel).join(", ") || "—",
    })),
  };
}

async function monthlyTable(people: ScopedEmployee[], month: string): Promise<ReportTable> {
  const days = daysInMonth(month);
  const start = parseIsoDate(days[0] ?? `${month}-01`);
  const end = parseIsoDate(days[days.length - 1] ?? `${month}-01`);
  const records =
    people.length === 0
      ? []
      : await getDb().attendanceRecord.findMany({
          where: {
            employeeId: { in: people.map((person) => person.id) },
            workDate: { gte: start, lte: end },
          },
          select: { employeeId: true, status: true, flags: true },
        });
  const byEmployee = new Map<string, typeof records>();
  for (const record of records) {
    const list = byEmployee.get(record.employeeId) ?? [];
    list.push(record);
    byEmployee.set(record.employeeId, list);
  }
  const zero = () => ({
    PRESENT: 0,
    WFH: 0,
    HALF_DAY: 0,
    ABSENT: 0,
    ON_LEAVE: 0,
    HOLIDAY: 0,
    WEEKLY_OFF: 0,
    INCOMPLETE: 0,
    LATE: 0,
  });
  return {
    type: "attendance-monthly",
    title: "Monthly attendance",
    columns: [
      { id: "name", header: "Name" },
      { id: "code", header: "Code" },
      { id: "department", header: "Department" },
      { id: "present", header: "Present" },
      { id: "wfh", header: "WFH" },
      { id: "halfDay", header: "Half day" },
      { id: "absent", header: "Absent" },
      { id: "onLeave", header: "On leave" },
      { id: "holiday", header: "Holiday" },
      { id: "weeklyOff", header: "Weekly off" },
      { id: "incomplete", header: "Incomplete" },
      { id: "late", header: "Late" },
    ],
    rows: people.map((person) => {
      const counts = zero();
      for (const record of byEmployee.get(person.id) ?? []) {
        if (record.status in counts) {
          counts[record.status as keyof ReturnType<typeof zero>] += 1;
        }
        if (record.flags.includes("LATE")) counts.LATE += 1;
      }
      return {
        id: person.id,
        name: person.name,
        code: person.employeeCode,
        department: person.departmentName,
        present: String(counts.PRESENT),
        wfh: String(counts.WFH),
        halfDay: String(counts.HALF_DAY),
        absent: String(counts.ABSENT),
        onLeave: String(counts.ON_LEAVE),
        holiday: String(counts.HOLIDAY),
        weeklyOff: String(counts.WEEKLY_OFF),
        incomplete: String(counts.INCOMPLETE),
        late: String(counts.LATE),
      };
    }),
  };
}

async function leaveBalanceTable(people: ScopedEmployee[]): Promise<ReportTable> {
  const types = await getDb().leaveType.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, code: true },
  });
  const sums =
    people.length === 0 || types.length === 0
      ? []
      : await getDb().leaveLedger.groupBy({
          by: ["employeeId", "leaveTypeId"],
          where: {
            employeeId: { in: people.map((person) => person.id) },
            leaveTypeId: { in: types.map((type) => type.id) },
          },
          _sum: { days: true },
        });
  const balance = new Map<string, string>();
  for (const row of sums) {
    balance.set(`${row.employeeId}:${row.leaveTypeId}`, row._sum.days?.toFixed(2) ?? "0.00");
  }
  return {
    type: "leave-balances",
    title: "Leave balances",
    columns: [
      { id: "name", header: "Name" },
      { id: "code", header: "Code" },
      { id: "department", header: "Department" },
      ...types.map((type) => ({ id: type.code, header: type.name })),
    ],
    rows: people.map((person) => {
      const row: ReportRow = {
        id: person.id,
        name: person.name,
        code: person.employeeCode,
        department: person.departmentName,
      };
      for (const type of types) {
        row[type.code] = balance.get(`${person.id}:${type.id}`) ?? "0.00";
      }
      return row;
    }),
  };
}

async function buildTable(actor: Principal, search: ReportSearch): Promise<ReportTable> {
  if (search.type === "headcount") {
    const people = await scopedEmployees(actor, {
      departmentId: search.departmentId || undefined,
      locationId: search.locationId || undefined,
      status: search.status || undefined,
    });
    return headcountTable(people, search.groupBy);
  }

  const people = await scopedEmployees(actor, {
    departmentId: search.departmentId || undefined,
    locationId: search.locationId || undefined,
    status: search.status || undefined,
    workingOnly: !search.status,
  });

  if (search.type === "attendance-daily") {
    const rows = await listAttendanceRowsForEmployees(
      people.map((person) => person.id),
      search.date,
    );
    return dailyTable(rows);
  }
  if (search.type === "attendance-monthly") {
    return monthlyTable(people, search.month);
  }
  return leaveBalanceTable(people);
}

export async function loadReport(actorId: string, search: ReportSearch): Promise<ReportPage> {
  const actor = await requireReporter(actorId);
  const [table, options] = await Promise.all([buildTable(actor, search), filterOptions(actor)]);
  return {
    search,
    table: { ...table, rows: table.rows.slice(0, REPORT_EXPORT_LIMIT) },
    departments: options.departments,
    locations: options.locations,
  };
}

function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }
  return guarded;
}

export function toReportCsv(table: ReportTable): string {
  const header = table.columns.map((column) => csvCell(column.header));
  const lines = [header.join(",")];
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvCell(row[column.id] ?? "")).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function exportReport(input: {
  actorId: string;
  search: ReportSearch;
  meta?: AuditMeta;
}): Promise<{ filename: string; csv: string; rowCount: number }> {
  const page = await loadReport(input.actorId, input.search);
  await audit.log({
    actor: input.actorId,
    action: AUDIT_ACTIONS.REPORT_EXPORTED,
    entityType: "Report",
    entityId: input.search.type,
    before: null,
    after: {
      type: input.search.type,
      groupBy: input.search.groupBy,
      departmentId: input.search.departmentId || null,
      locationId: input.search.locationId || null,
      status: input.search.status || null,
      date: input.search.type === "attendance-daily" ? input.search.date : null,
      month: input.search.type === "attendance-monthly" ? input.search.month : null,
      rowCount: page.table.rows.length,
    },
    ipAddress: input.meta?.ipAddress,
    userAgent: input.meta?.userAgent,
  });
  const stamp =
    input.search.type === "attendance-daily"
      ? `-${input.search.date}`
      : input.search.type === "attendance-monthly"
        ? `-${input.search.month}`
        : "";
  return {
    filename: `avanza-${input.search.type}${stamp}.csv`,
    csv: toReportCsv(page.table),
    rowCount: page.table.rows.length,
  };
}

export function isoWeekRange(today: string): { from: string; to: string } {
  const from = addDaysIso(today, -WEEKDAYS.indexOf(weekdayOf(today)));
  return { from, to: addDaysIso(from, 6) };
}

export async function loadScopedWorkingEmployees(actor: Principal): Promise<ScopedEmployee[]> {
  return scopedEmployees(actor, { workingOnly: true });
}

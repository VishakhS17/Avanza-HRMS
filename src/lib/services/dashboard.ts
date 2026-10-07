import { getDb } from "@/lib/db";
import { daysInMonth, formatIsoDate, parseIsoDate, todayIso } from "@/lib/leave-dates";
import { can, type Principal } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { countPendingApprovals } from "@/lib/services/approvals";
import {
  getPunchStatus,
  listAttendanceRowsForEmployees,
  type DailyAttendanceRow,
  type PunchStatus,
} from "@/lib/services/attendance";
import { listMyDocuments, POLICIES } from "@/lib/services/documents";
import { listMyHolidays } from "@/lib/services/holidays";
import { listMyLeave } from "@/lib/services/leave";
import { isoWeekRange, loadScopedWorkingEmployees } from "@/lib/services/reports";

const EFFECTIVE_LEAVE = ["APPROVED", "CANCELLATION_PENDING"] as const;
const OPEN_REQUEST = ["PENDING", "CANCELLATION_PENDING"] as const;

export type DashboardLeaveBalance = {
  leaveTypeId: string;
  name: string;
  balance: string;
};

export type DashboardLeaveRequest = {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
};

export type DashboardHoliday = {
  id: string;
  date: string;
  name: string;
};

export type DashboardDocument = {
  id: string;
  title: string;
};

export type DashboardOutPerson = {
  employeeId: string;
  name: string;
  leaveType: string;
  startDate: string;
  endDate: string;
};

export type DashboardMissingPunch = {
  employeeId: string;
  name: string;
  status: string | null;
};

export type DashboardHrAction = {
  label: string;
  count: number;
  href: string;
};

export type ManagerHome = {
  pendingApprovals: number;
  outToday: DashboardOutPerson[];
  outThisWeek: DashboardOutPerson[];
  attendanceToday: { status: string; count: number }[];
  missingPunches: DashboardMissingPunch[];
};

export type HrHome = {
  headcount: { status: string; count: number }[];
  joinersThisMonth: { id: string; name: string; joiningDate: string }[];
  exitsThisMonth: { id: string; name: string; exitDate: string }[];
  attendanceToday: { status: string; count: number }[];
  pendingActions: DashboardHrAction[];
};

export type HomeDashboard = {
  punch: PunchStatus;
  leaveBalances: DashboardLeaveBalance[];
  pendingRequests: DashboardLeaveRequest[];
  holidays: DashboardHoliday[];
  pendingDocuments: DashboardDocument[];
  manager: ManagerHome | null;
  hr: HrHome | null;
};

function summarizeAttendance(rows: DailyAttendanceRow[]): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.status ?? "Not recorded";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

function isMissingPunch(row: DailyAttendanceRow): boolean {
  if (row.flags.includes("INCOMPLETE") || row.status === "INCOMPLETE") return true;
  if (row.status === "HOLIDAY" || row.status === "WEEKLY_OFF" || row.status === "ON_LEAVE") return false;
  return !row.firstIn && row.status !== "PRESENT" && row.status !== "WFH" && row.status !== "HALF_DAY";
}

async function loadOut(employeeIds: readonly string[], from: string, to: string): Promise<DashboardOutPerson[]> {
  if (employeeIds.length === 0) return [];
  const rows = await getDb().leaveRequest.findMany({
    where: {
      employeeId: { in: [...employeeIds] },
      status: { in: [...EFFECTIVE_LEAVE] },
      startDate: { lte: parseIsoDate(to) },
      endDate: { gte: parseIsoDate(from) },
    },
    include: {
      employee: { select: { name: true } },
      leaveType: { select: { name: true } },
    },
    orderBy: [{ startDate: "asc" }, { employee: { name: "asc" } }],
  });
  return rows.map((row) => ({
    employeeId: row.employeeId,
    name: row.employee.name,
    leaveType: row.leaveType.name,
    startDate: formatIsoDate(row.startDate),
    endDate: formatIsoDate(row.endDate),
  }));
}

async function loadManagerHome(actor: Principal, today: string): Promise<ManagerHome> {
  const teamIds = [...actor.directReportIds];
  const week = isoWeekRange(today);
  const [pendingApprovals, outToday, outThisWeek, attendanceRows] = await Promise.all([
    countPendingApprovals(actor.id),
    loadOut(teamIds, today, today),
    loadOut(teamIds, week.from, week.to),
    listAttendanceRowsForEmployees(teamIds, today),
  ]);
  return {
    pendingApprovals,
    outToday,
    outThisWeek,
    attendanceToday: summarizeAttendance(attendanceRows),
    missingPunches: attendanceRows.filter(isMissingPunch).map((row) => ({
      employeeId: row.employeeId,
      name: row.name,
      status: row.status,
    })),
  };
}

async function loadHrHome(actor: Principal, today: string): Promise<HrHome> {
  const month = today.slice(0, 7);
  const days = daysInMonth(month);
  const monthStart = parseIsoDate(days[0] ?? `${month}-01`);
  const monthLast = parseIsoDate(days[days.length - 1] ?? `${month}-01`);
  const people = await loadScopedWorkingEmployees(actor);
  const [statusGroups, joiners, exits, attendanceRows, pendingApprovals, pendingLeave, preJoining] = await Promise.all([
    getDb().employee.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    getDb().employee.findMany({
      where: { joiningDate: { gte: monthStart, lte: monthLast } },
      select: { id: true, name: true, joiningDate: true },
      orderBy: { joiningDate: "asc" },
      take: 20,
    }),
    getDb().employee.findMany({
      where: { exitDate: { gte: monthStart, lte: monthLast } },
      select: { id: true, name: true, exitDate: true },
      orderBy: { exitDate: "asc" },
      take: 20,
    }),
    listAttendanceRowsForEmployees(
      people.map((person) => person.id),
      today,
    ),
    countPendingApprovals(actor.id),
    can(actor, "leave.manage")
      ? getDb().leaveRequest.count({ where: { status: { in: [...OPEN_REQUEST] } } })
      : Promise.resolve(0),
    getDb().employee.count({ where: { status: "PRE_JOINING" } }),
  ]);

  const pendingActions: DashboardHrAction[] = [];
  if (pendingApprovals > 0) {
    pendingActions.push({ label: "Inbox approvals", count: pendingApprovals, href: "/inbox" });
  }
  if (can(actor, "leave.manage")) {
    pendingActions.push({ label: "Pending leave", count: pendingLeave, href: "/leave" });
  }
  if (can(actor, "documents.manage")) {
    const pendingDocs = await getDb().document.findMany({
      where: {
        status: "ACTIVE",
        requiresAcknowledgement: true,
        NOT: {
          AND: [{ category: { code: { not: POLICIES } } }, { assignments: { some: { employeeId: actor.id } } }],
        },
      },
      select: {
        assignments: { select: { employeeId: true, employee: { select: { status: true } } } },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { acknowledgements: { select: { userId: true } } },
        },
      },
    });
    let pendingAcks = 0;
    for (const doc of pendingDocs) {
      const acked = new Set(doc.versions[0]?.acknowledgements.map((row) => row.userId) ?? []);
      pendingAcks += doc.assignments.filter(
        (assignment) => assignment.employee.status !== "EXITED" && !acked.has(assignment.employeeId),
      ).length;
    }
    pendingActions.push({ label: "Document acknowledgements", count: pendingAcks, href: "/documents?pending=1" });
  }
  pendingActions.push({ label: "Pre-joining", count: preJoining, href: "/people?status=PRE_JOINING" });

  const wanted = ["ACTIVE", "NOTICE", "PRE_JOINING"] as const;
  const countByStatus = new Map(statusGroups.map((row) => [row.status, row._count._all]));
  return {
    headcount: wanted.map((status) => ({ status, count: countByStatus.get(status) ?? 0 })),
    joinersThisMonth: joiners.map((row) => ({
      id: row.id,
      name: row.name,
      joiningDate: formatIsoDate(row.joiningDate),
    })),
    exitsThisMonth: exits.map((row) => ({
      id: row.id,
      name: row.name,
      exitDate: row.exitDate ? formatIsoDate(row.exitDate) : "",
    })),
    attendanceToday: summarizeAttendance(attendanceRows),
    pendingActions,
  };
}

export async function loadHomeDashboard(actorId: string, now = new Date()): Promise<HomeDashboard> {
  const actor = await requireActiveActor(actorId);
  const today = todayIso(now);
  const [punch, leave, holidays, documents] = await Promise.all([
    getPunchStatus(actor.id),
    listMyLeave(actor.id),
    listMyHolidays(actor.id),
    listMyDocuments(actor.id),
  ]);
  const paidBalances = leave.balances.filter((row) => row.code !== "LOP").slice(0, 3);
  const pendingRequests = leave.history
    .filter((row) => row.status === "PENDING" || row.status === "CANCELLATION_PENDING")
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      leaveType: row.leaveType,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
    }));
  const upcomingHolidays = holidays.holidays.filter((row) => row.date >= today).slice(0, 3);
  const pendingDocuments = documents.fromHr
    .filter((row) => row.pendingAcknowledgement)
    .slice(0, 5)
    .map((row) => ({ id: row.id, title: row.title }));

  const showManager = actor.roles.includes("MANAGER");
  const showHr = actor.roles.includes("HR_ADMIN") || actor.roles.includes("SUPER_ADMIN");
  const [manager, hr] = await Promise.all([
    showManager ? loadManagerHome(actor, today) : Promise.resolve(null),
    showHr ? loadHrHome(actor, today) : Promise.resolve(null),
  ]);

  return {
    punch,
    leaveBalances: paidBalances.map((row) => ({
      leaveTypeId: row.leaveTypeId,
      name: row.name,
      balance: row.balance,
    })),
    pendingRequests,
    holidays: upcomingHolidays,
    pendingDocuments,
    manager,
    hr,
  };
}

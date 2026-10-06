import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { EmployeeError } from "@/lib/services/employee-errors";

type ReportingDb = PrismaClient | Prisma.TransactionClient;

/**
 * Current direct reports: open employment, and the person is active or on notice.
 * Ids match User.id because Employee.id is the user id.
 */
export async function listDirectReportIds(managerUserId: string): Promise<string[]> {
  const rows = await getDb().employment.findMany({
    where: {
      reportingManagerId: managerUserId,
      endDate: null,
      employee: { status: { in: ["ACTIVE", "NOTICE"] } },
    },
    select: { employeeId: true },
    orderBy: { employeeId: "asc" },
  });
  return rows.map((row) => row.employeeId);
}

/**
 * Walks up from the proposed manager. Returns an error when the employee would
 * sit above that manager, including a self-report.
 */
export function reportingCycleError(
  employeeId: string,
  nextManagerId: string | null,
  managerByEmployee: ReadonlyMap<string, string | null>,
): string | null {
  if (!nextManagerId) {
    return null;
  }
  if (nextManagerId === employeeId) {
    return "An employee cannot report to themselves.";
  }

  const seen = new Set<string>();
  let current: string | null = nextManagerId;
  while (current) {
    if (current === employeeId || seen.has(current)) {
      return "That manager would create a reporting cycle.";
    }
    seen.add(current);
    current = managerByEmployee.get(current) ?? null;
  }
  return null;
}

export async function assertReportingLine(
  db: ReportingDb,
  employeeId: string,
  managerId: string | null,
): Promise<void> {
  if (!managerId) {
    return;
  }

  const manager = await db.employee.findUnique({
    where: { id: managerId },
    include: { employments: { where: { endDate: null }, take: 1 } },
  });
  if (!manager || manager.employments.length === 0) {
    throw new EmployeeError("Choose a current employee as the manager.");
  }
  if (manager.status !== "ACTIVE" && manager.status !== "NOTICE") {
    throw new EmployeeError("The manager must be active or on notice.");
  }

  const rows = await db.employment.findMany({
    where: { endDate: null },
    select: { employeeId: true, reportingManagerId: true },
  });
  const managerByEmployee = new Map(rows.map((row) => [row.employeeId, row.reportingManagerId]));
  const message = reportingCycleError(employeeId, managerId, managerByEmployee);
  if (message) {
    throw new EmployeeError(message);
  }
}

import { getDb } from "@/lib/db";
import { buildPrincipal, type Principal } from "@/lib/permissions";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { listDirectReportIds } from "@/lib/services/reporting";

/** Loads a live user and their current direct reports for a service check. */
export async function requireActiveActor(actorId: string): Promise<Principal> {
  const user = await getDb().user.findUnique({ where: { id: actorId } });
  if (!user || user.status !== "ACTIVE") {
    throw new EmployeeAccessError("forbidden", "You cannot do that.");
  }
  const directReportIds = await listDirectReportIds(user.id);
  return buildPrincipal({
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    assignedRoles: user.roles,
    directReportIds,
  });
}

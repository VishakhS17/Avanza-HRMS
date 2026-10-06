import { getDb } from "@/lib/db";
import type { AuditDb } from "@/lib/services/audit";
import { LeaveError } from "@/lib/services/leave-errors";

const OPEN_STATUSES = ["ACTIVE", "NOTICE"] as ("ACTIVE" | "NOTICE")[];

/**
 * Reporting manager when that user is active. Otherwise the earliest active
 * HR Admin, then the earliest active Super Admin. Never the requester.
 */
export async function resolveApprover(db: AuditDb, requesterId: string): Promise<string> {
  const employment = await db.employment.findFirst({
    where: { employeeId: requesterId, endDate: null },
    select: { reportingManagerId: true },
  });
  const managerId = employment?.reportingManagerId;
  if (managerId && managerId !== requesterId) {
    const manager = await db.user.findUnique({
      where: { id: managerId },
      select: { id: true, status: true },
    });
    if (manager?.status === "ACTIVE") return manager.id;
  }

  const hrAdmin = await db.user.findFirst({
    where: { status: "ACTIVE", id: { not: requesterId }, roles: { has: "HR_ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (hrAdmin) return hrAdmin.id;

  const superAdmin = await db.user.findFirst({
    where: { status: "ACTIVE", id: { not: requesterId }, roles: { has: "SUPER_ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (superAdmin) return superAdmin.id;

  throw new LeaveError("No approver is available. Ask HR to assign a manager.");
}

async function isCurrentManager(
  db: AuditDb,
  managerId: string,
  employeeId: string,
): Promise<boolean> {
  const row = await db.employment.findFirst({
    where: {
      employeeId,
      endDate: null,
      reportingManagerId: managerId,
      employee: { status: { in: OPEN_STATUSES } },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * The actor must be the stored approver, must not be the requester, and must
 * still be that person's manager unless they are HR Admin or Super Admin.
 * HR can also decide when the stored approver is inactive or no longer the manager.
 */
export async function assertCanDecide(
  db: AuditDb,
  actorId: string,
  approval: { requesterId: string; approverId: string },
): Promise<void> {
  if (actorId === approval.requesterId) {
    throw new LeaveError("You cannot approve your own request.");
  }

  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { id: true, status: true, roles: true },
  });
  if (!actor || actor.status !== "ACTIVE") {
    throw new LeaveError("You cannot act on this request.");
  }

  const isAdmin = actor.roles.includes("HR_ADMIN") || actor.roles.includes("SUPER_ADMIN");
  const managesRequester = await isCurrentManager(db, actorId, approval.requesterId);
  if (actorId === approval.approverId && (isAdmin || managesRequester)) {
    return;
  }

  if (isAdmin) {
    const approver = await db.user.findUnique({
      where: { id: approval.approverId },
      select: { status: true },
    });
    const approverStillManages = await isCurrentManager(db, approval.approverId, approval.requesterId);
    if (!approver || approver.status !== "ACTIVE" || !approverStillManages) {
      return;
    }
  }

  throw new LeaveError("You cannot act on this request.");
}

export async function countPendingApprovals(userId: string): Promise<number> {
  return getDb().approvalRequest.count({
    where: { approverId: userId, status: "PENDING" },
  });
}

export async function createNotification(
  db: AuditDb,
  input: { userId: string; title: string; body: string; href?: string | null },
) {
  await db.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      body: input.body,
      href: input.href ?? null,
    },
  });
}

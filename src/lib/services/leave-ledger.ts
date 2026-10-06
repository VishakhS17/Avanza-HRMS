import { Prisma, type LedgerEntryType } from "@/generated/prisma/client";
import { audit, type AuditAction, type AuditDb } from "@/lib/services/audit";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new Error("Employee not found.");
  }
}

export async function lockApproval(tx: Prisma.TransactionClient, approvalId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM approval_requests WHERE id = ${approvalId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new Error("Approval not found.");
  }
}

export async function sumLeaveLedger(
  db: AuditDb,
  employeeId: string,
  leaveTypeId: string,
  createdBefore?: Date,
): Promise<Prisma.Decimal> {
  const aggregate = await db.leaveLedger.aggregate({
    where: {
      employeeId,
      leaveTypeId,
      ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}),
    },
    _sum: { days: true },
  });
  return aggregate._sum.days ?? new Prisma.Decimal(0);
}

export async function postLeaveLedger(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string | null;
    employeeId: string;
    leaveTypeId: string;
    entryType: LedgerEntryType;
    days: Prisma.Decimal;
    leaveRequestId?: string | null;
    reversesId?: string | null;
    idempotencyKey?: string | null;
    reason?: string | null;
    action: AuditAction;
    meta?: AuditMeta;
  },
) {
  const row = await tx.leaveLedger.create({
    data: {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      entryType: input.entryType,
      days: input.days,
      leaveRequestId: input.leaveRequestId ?? null,
      reversesId: input.reversesId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      reason: input.reason ?? null,
      createdById: input.actorId,
    },
  });
  await audit.log(
    {
      actor: input.actorId,
      action: input.action,
      entityType: "LeaveLedger",
      entityId: row.id,
      before: null,
      after: {
        entryType: row.entryType,
        days: row.days.toFixed(2),
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        leaveRequestId: row.leaveRequestId,
        reversesId: row.reversesId,
        idempotencyKey: row.idempotencyKey,
      },
      reason: input.reason,
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
    },
    tx,
  );
  return row;
}

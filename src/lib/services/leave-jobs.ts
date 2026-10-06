import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { addMonthsIso, formatIsoDate, todayIso } from "@/lib/leave-dates";
import { AUDIT_ACTIONS } from "@/lib/services/audit";
import { LeaveError } from "@/lib/services/leave-errors";
import { lockEmployee, postLeaveLedger, sumLeaveLedger } from "@/lib/services/leave-ledger";

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Credits monthly and annual leave for the Asia/Kolkata month or year of `asOf`.
 * A second run for the same period does not add days. Pass `employeeIds` to limit the run.
 */
export async function runLeaveAccrual(input?: { asOf?: Date; employeeIds?: string[] }) {
  const today = todayIso(input?.asOf ?? new Date());
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const policies = await getDb().leavePolicy.findMany({ include: { leaveType: true } });
  const employees = await getDb().employee.findMany({
    where: {
      status: { in: ["ACTIVE", "NOTICE"] },
      ...(input?.employeeIds ? { id: { in: input.employeeIds } } : {}),
    },
    select: { id: true, joiningDate: true },
  });

  let credited = 0;
  for (const policy of policies) {
    if (policy.accrualMode === "MANUAL" || !policy.leaveType.isActive) continue;
    if (policy.accrualDays.lessThanOrEqualTo(0)) continue;
    const period = policy.accrualMode === "MONTHLY" ? month : year;
    for (const employee of employees) {
      if (!policy.probationEligible) {
        const end = addMonthsIso(formatIsoDate(employee.joiningDate), policy.probationMonths);
        if (today < end) continue;
      }
      const key = `accrual:${employee.id}:${policy.leaveTypeId}:${period}`;
      try {
        const wrote = await getDb().$transaction(async (tx) => {
          const existing = await tx.leaveLedger.findUnique({ where: { idempotencyKey: key } });
          if (existing) return false;
          await lockEmployee(tx, employee.id);
          await postLeaveLedger(tx, {
            actorId: null,
            employeeId: employee.id,
            leaveTypeId: policy.leaveTypeId,
            entryType: "ACCRUAL",
            days: policy.accrualDays,
            idempotencyKey: key,
            reason: `Accrual ${period}`,
            action: AUDIT_ACTIONS.LEAVE_ACCRUED,
          });
          return true;
        });
        if (wrote) credited += 1;
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
      }
    }
  }
  return { credited };
}

/**
 * For a completed calendar year, posts one carry-forward row per employee and type.
 * Days above the cap are removed. A second run for that year does nothing.
 */
export async function runLeaveCarryForward(input: { year: number; employeeIds?: string[] }) {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new LeaveError("Choose a leave year between 2000 and 2100.");
  }
  const cutoff = new Date(`${input.year + 1}-01-01T00:00:00+05:30`);
  const policies = await getDb().leavePolicy.findMany({ include: { leaveType: true } });
  const employees = await getDb().employee.findMany({
    where: {
      status: { in: ["ACTIVE", "NOTICE"] },
      ...(input?.employeeIds ? { id: { in: input.employeeIds } } : {}),
    },
    select: { id: true },
  });

  let written = 0;
  for (const policy of policies) {
    if (!policy.leaveType.isActive) continue;
    for (const employee of employees) {
      const key = `carry:${employee.id}:${policy.leaveTypeId}:${input.year}`;
      try {
        const did = await getDb().$transaction(async (tx) => {
          const existing = await tx.leaveLedger.findUnique({ where: { idempotencyKey: key } });
          if (existing) return false;
          await lockEmployee(tx, employee.id);
          const balance = await sumLeaveLedger(tx, employee.id, policy.leaveTypeId, cutoff);
          const excess = balance.greaterThan(policy.carryForwardCap)
            ? balance.sub(policy.carryForwardCap)
            : new Prisma.Decimal(0);
          await postLeaveLedger(tx, {
            actorId: null,
            employeeId: employee.id,
            leaveTypeId: policy.leaveTypeId,
            entryType: "CARRY_FORWARD",
            days: excess.negated(),
            idempotencyKey: key,
            reason: `Year-end carry-forward for ${input.year}`,
            action: AUDIT_ACTIONS.LEAVE_CARRY_FORWARD,
          });
          return true;
        });
        if (did) written += 1;
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
      }
    }
  }
  return { written };
}

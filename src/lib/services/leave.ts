import { Prisma, type LeaveRequestStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  addMonthsIso,
  countLeaveDays,
  formatDays,
  formatIsoDate,
  formatZonedDate,
  parseIsoDate,
  todayIso,
  type CountedDay,
  type HalfSession,
} from "@/lib/leave-dates";
import { can } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { assertCanDecide, createNotification, resolveApprover } from "@/lib/services/approvals";
import { recomputeAttendance } from "@/lib/services/attendance";
import { AUDIT_ACTIONS, audit, type AuditDb } from "@/lib/services/audit";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { LeaveError } from "@/lib/services/leave-errors";
import { lockApproval, lockEmployee, postLeaveLedger, sumLeaveLedger } from "@/lib/services/leave-ledger";
import { deliverMail, type MailMessage } from "@/lib/services/mail";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

const OPEN_REQUEST = ["PENDING", "APPROVED", "CANCELLATION_PENDING"] as const;

/** Leave that counts on the attendance calendar. A pending cancellation is still approved leave. */
function isEffectiveLeave(status: LeaveRequestStatus): boolean {
  return status === "APPROVED" || status === "CANCELLATION_PENDING";
}

type PolicyRow = {
  accrualMode: "MONTHLY" | "ANNUAL" | "MANUAL";
  accrualDays: Prisma.Decimal;
  carryForwardCap: Prisma.Decimal;
  halfDayAllowed: boolean;
  excludeWeekends: boolean;
  excludeHolidays: boolean;
  probationEligible: boolean;
  probationMonths: number;
  balanceEnforced: boolean;
};

export type LeavePreview = {
  ok: boolean;
  message: string | null;
  workingDays: string | null;
  balance: string | null;
  dates: string[];
};

export type LeaveBalanceView = {
  leaveTypeId: string;
  code: string;
  name: string;
  balance: string;
  halfDayAllowed: boolean;
};

export type LeaveHistoryView = {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  session: HalfSession | null;
  workingDays: string;
  status: LeaveRequestStatus;
  reason: string;
  comment: string | null;
  canCancelDirectly: boolean;
  canRequestCancellation: boolean;
};

export type LeaveRequestView = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  session: HalfSession | null;
  workingDays: string;
  status: LeaveRequestStatus;
  reason: string;
};

export type LedgerView = {
  id: string;
  leaveType: string;
  entryType: string;
  days: string;
  reason: string | null;
  createdAt: string;
  canReverse: boolean;
};

export type TeamLeaveEntry = {
  employeeId: string;
  name: string;
  leaveType: string;
  status: LeaveRequestStatus;
  portion: string;
};

export type OverlapView = {
  name: string;
  date: string;
  leaveType: string;
  portion: string;
  status: LeaveRequestStatus;
};

function requiredText(value: string, label: string): string {
  const text = value.trim();
  if (text.length < 1 || text.length > 500) {
    throw new LeaveError(`${label} must be 1 to 500 characters.`);
  }
  return text;
}

function optionalComment(value: string | undefined, required: boolean): string | null {
  const text = value?.trim() ?? "";
  if (!text && required) throw new LeaveError("A rejection needs a comment.");
  if (text.length > 500) throw new LeaveError("Comment must be 500 characters or fewer.");
  return text || null;
}

function parseSession(value: string | null | undefined): HalfSession | null {
  if (!value || value === "FULL") return null;
  if (value === "FIRST" || value === "SECOND") return value;
  throw new LeaveError("Choose a full day or a half day.");
}

function parseSignedDays(value: string): Prisma.Decimal {
  const trimmed = value.trim();
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new LeaveError("Enter days with up to two decimal places.");
  }
  const days = new Prisma.Decimal(trimmed);
  if (days.isZero() || days.abs().greaterThan(366)) {
    throw new LeaveError("Enter a non-zero day count up to 366.");
  }
  return days;
}

function workingTotal(days: CountedDay[]): Prisma.Decimal {
  return days.reduce((sum, day) => sum.add(day.portion), new Prisma.Decimal(0));
}

function summary(typeName: string, from: string, to: string, days: Prisma.Decimal): string {
  const shown = formatDays(days);
  const unit = shown === "1" ? "working day" : "working days";
  return `${typeName} from ${from} to ${to} (${shown} ${unit})`;
}

async function requireLeaveAdmin(actorId: string) {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "leave.manage")) {
    throw new EmployeeAccessError("forbidden", "You cannot manage leave.");
  }
  return actor;
}

async function openJob(db: AuditDb, employeeId: string) {
  return db.employment.findFirst({
    where: { employeeId, endDate: null },
    include: { location: true },
  });
}

async function holidayDates(db: AuditDb, locationId: string, from: string, to: string) {
  const rows = await db.holiday.findMany({
    where: {
      locationId,
      isActive: true,
      date: { gte: parseIsoDate(from), lte: parseIsoDate(to) },
    },
    select: { date: true },
  });
  return rows.map((row) => formatIsoDate(row.date));
}

async function loadType(db: AuditDb, leaveTypeId: string) {
  const leaveType = await db.leaveType.findFirst({
    where: { id: leaveTypeId, isActive: true },
    include: { policy: true },
  });
  if (!leaveType?.policy) throw new LeaveError("Choose a leave type.");
  return { leaveType, policy: leaveType.policy };
}

function assertProbation(policy: PolicyRow, joiningDate: Date, startDate: string, today: string) {
  if (policy.probationEligible) return;
  const end = addMonthsIso(formatIsoDate(joiningDate), policy.probationMonths);
  if (today < end || startDate < end) {
    throw new LeaveError("This leave is not available during probation.");
  }
}

async function assertNoOverlap(
  db: AuditDb,
  employeeId: string,
  days: CountedDay[],
  excludeRequestId?: string,
) {
  const existing = await db.leaveRequestDay.findMany({
    where: {
      employeeId,
      date: { in: days.map((day) => parseIsoDate(day.date)) },
      leaveRequest: {
        status: { in: [...OPEN_REQUEST] },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
    },
  });
  for (const day of days) {
    const same = existing.filter((row) => formatIsoDate(row.date) === day.date);
    let used = new Prisma.Decimal(0);
    for (const row of same) {
      used = used.add(row.portion);
      const blocks = !day.session || !row.session || row.session === day.session;
      if (blocks) {
        throw new LeaveError("Those dates overlap an existing leave request.");
      }
    }
    if (used.add(day.portion).greaterThan(1)) {
      throw new LeaveError("Those dates overlap an existing leave request.");
    }
  }
}

async function countedDaysFor(
  db: AuditDb,
  employeeId: string,
  policy: PolicyRow,
  startDate: string,
  endDate: string,
  session: HalfSession | null,
) {
  const job = await openJob(db, employeeId);
  if (!job) throw new LeaveError("You need a current job record before applying for leave.");
  const holidays = await holidayDates(db, job.locationId, startDate, endDate);
  return countLeaveDays({
    from: startDate,
    to: endDate,
    session,
    weeklyOff: job.location.weeklyOff,
    holidayDates: holidays,
    excludeWeekends: policy.excludeWeekends,
    excludeHolidays: policy.excludeHolidays,
    halfDayAllowed: policy.halfDayAllowed,
  });
}

async function auditStatus(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string | null;
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
    entityType: string;
    entityId: string;
    before: unknown;
    after: unknown;
    reason?: string | null;
    meta?: AuditMeta;
  },
) {
  await audit.log(
    {
      actor: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      reason: input.reason,
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
    },
    tx,
  );
}

async function usersById(db: AuditDb, ids: string[]) {
  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

export async function leaveBalance(employeeId: string, leaveTypeId: string): Promise<Prisma.Decimal> {
  return sumLeaveLedger(getDb(), employeeId, leaveTypeId);
}

export async function previewLeave(input: {
  actorId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  session: string;
}): Promise<LeavePreview> {
  await requireActiveActor(input.actorId);
  const empty: LeavePreview = {
    ok: false,
    message: null,
    workingDays: null,
    balance: null,
    dates: [],
  };
  if (!input.leaveTypeId) return { ...empty, message: "Choose a leave type." };

  try {
    const { leaveType, policy } = await loadType(getDb(), input.leaveTypeId);
    const balance = await sumLeaveLedger(getDb(), input.actorId, leaveType.id);
    const balanceText = balance.toFixed(2);
    if (!input.startDate || !input.endDate) {
      return { ok: true, message: null, workingDays: null, balance: balanceText, dates: [] };
    }
    const employee = await getDb().employee.findUnique({ where: { id: input.actorId } });
    if (!employee) throw new LeaveError("You need an employee record before applying for leave.");
    const session = parseSession(input.session);
    assertProbation(policy, employee.joiningDate, input.startDate, todayIso());
    const days = await countedDaysFor(getDb(), input.actorId, policy, input.startDate, input.endDate, session);
    const total = workingTotal(days);
    try {
      await assertNoOverlap(getDb(), input.actorId, days);
    } catch (error) {
      if (error instanceof LeaveError) {
        return {
          ok: false,
          message: error.message,
          workingDays: total.toFixed(2),
          balance: balanceText,
          dates: days.map((day) => day.date),
        };
      }
      throw error;
    }
    if (policy.balanceEnforced && balance.lessThan(total)) {
      return {
        ok: false,
        message: "That request is more than the available balance.",
        workingDays: total.toFixed(2),
        balance: balanceText,
        dates: days.map((day) => day.date),
      };
    }
    return {
      ok: true,
      message: null,
      workingDays: total.toFixed(2),
      balance: balanceText,
      dates: days.map((day) => day.date),
    };
  } catch (error) {
    if (error instanceof LeaveError) return { ...empty, message: error.message };
    throw error;
  }
}

export async function submitLeaveRequest(input: {
  actorId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  session: string;
  reason: string;
  meta?: AuditMeta;
}) {
  const actor = await requireActiveActor(input.actorId);
  const employee = await getDb().employee.findUnique({ where: { id: actor.id } });
  if (!employee || (employee.status !== "ACTIVE" && employee.status !== "NOTICE")) {
    throw new LeaveError("Leave is available to active employees and people on notice.");
  }
  const reason = requiredText(input.reason, "Reason");
  const session = parseSession(input.session);
  const { leaveType, policy } = await loadType(getDb(), input.leaveTypeId);
  assertProbation(policy, employee.joiningDate, input.startDate, todayIso());
  const days = await countedDaysFor(getDb(), actor.id, policy, input.startDate, input.endDate, session);
  const total = workingTotal(days);

  const outcome = await getDb().$transaction(async (tx) => {
    await lockEmployee(tx, actor.id);
    await assertNoOverlap(tx, actor.id, days);
    if (policy.balanceEnforced) {
      const balance = await sumLeaveLedger(tx, actor.id, leaveType.id);
      if (balance.lessThan(total)) {
        throw new LeaveError("That request is more than the available balance.");
      }
    }
    const approverId = await resolveApprover(tx, actor.id);
    const request = await tx.leaveRequest.create({
      data: {
        employeeId: actor.id,
        leaveTypeId: leaveType.id,
        startDate: parseIsoDate(input.startDate),
        endDate: parseIsoDate(input.endDate),
        session,
        reason,
        status: "PENDING",
        workingDays: total,
      },
    });
    await tx.leaveRequestDay.createMany({
      data: days.map((day) => ({
        leaveRequestId: request.id,
        employeeId: actor.id,
        date: parseIsoDate(day.date),
        portion: day.portion,
        session: day.session,
      })),
    });
    await postLeaveLedger(tx, {
      actorId: actor.id,
      employeeId: actor.id,
      leaveTypeId: leaveType.id,
      entryType: "HOLD",
      days: total.negated(),
      leaveRequestId: request.id,
      idempotencyKey: `hold:${request.id}`,
      reason,
      action: AUDIT_ACTIONS.LEAVE_REQUESTED,
      meta: input.meta,
    });
    const approval = await tx.approvalRequest.create({
      data: {
        type: "LEAVE",
        targetType: "LeaveRequest",
        targetId: request.id,
        requesterId: actor.id,
        approverId,
        status: "PENDING",
      },
    });
    await auditStatus(tx, {
      actorId: actor.id,
      action: AUDIT_ACTIONS.LEAVE_REQUESTED,
      entityType: "LeaveRequest",
      entityId: request.id,
      before: null,
      after: { status: "PENDING", workingDays: total.toFixed(2), approverId },
      reason,
      meta: input.meta,
    });
    await auditStatus(tx, {
      actorId: actor.id,
      action: AUDIT_ACTIONS.LEAVE_REQUESTED,
      entityType: "ApprovalRequest",
      entityId: approval.id,
      before: null,
      after: { status: "PENDING", type: "LEAVE", approverId },
      reason,
      meta: input.meta,
    });

    const people = await usersById(tx, [actor.id, approverId]);
    const approver = people.get(approverId);
    const requester = people.get(actor.id);
    const text = `${requester?.name ?? "An employee"} requested ${summary(leaveType.name, input.startDate, input.endDate, total)}. Reason: ${reason}`;
    await createNotification(tx, {
      userId: approverId,
      title: "Leave request",
      body: text,
      href: "/inbox",
    });
    await createNotification(tx, {
      userId: actor.id,
      title: "Leave request submitted",
      body: `Your ${summary(leaveType.name, input.startDate, input.endDate, total)} is waiting for approval.`,
      href: "/my-space/leave",
    });
    const mail: MailMessage[] = [];
    if (approver) {
      mail.push({ to: approver.email, subject: "Leave request submitted", text });
    }
    if (requester) {
      mail.push({
        to: requester.email,
        subject: "Leave request submitted",
        text: `Your ${summary(leaveType.name, input.startDate, input.endDate, total)} was submitted.`,
      });
    }
    return { requestId: request.id, mail };
  });

  await deliverMail(outcome.mail);
  return outcome.requestId;
}

async function releaseHold(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string | null;
    request: { id: string; employeeId: string; leaveTypeId: string; workingDays: Prisma.Decimal };
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
    reason: string | null;
    meta?: AuditMeta;
    key: string;
  },
) {
  await postLeaveLedger(tx, {
    actorId: input.actorId,
    employeeId: input.request.employeeId,
    leaveTypeId: input.request.leaveTypeId,
    entryType: "RELEASE",
    days: input.request.workingDays,
    leaveRequestId: input.request.id,
    idempotencyKey: input.key,
    reason: input.reason,
    action: input.action,
    meta: input.meta,
  });
}

export async function cancelLeaveRequest(input: {
  actorId: string;
  requestId: string;
  meta?: AuditMeta;
}) {
  const actor = await requireActiveActor(input.actorId);
  const existing = await getDb().leaveRequest.findUnique({
    where: { id: input.requestId },
    include: { leaveType: true },
  });
  if (!existing || existing.employeeId !== actor.id) {
    throw new LeaveError("That leave request was not found.");
  }

  const today = todayIso();
  const start = formatIsoDate(existing.startDate);
  const direct = existing.status === "PENDING" && start > today;
  const needsApproval =
    existing.status === "APPROVED" || (existing.status === "PENDING" && start <= today);
  if (!direct && !needsApproval) {
    throw new LeaveError("That leave request cannot be cancelled.");
  }

  const outcome = await getDb().$transaction(async (tx) => {
    await lockEmployee(tx, actor.id);
    const request = await tx.leaveRequest.findUnique({
      where: { id: existing.id },
      include: { leaveType: true },
    });
    if (!request) throw new LeaveError("That leave request was not found.");
    const mail: MailMessage[] = [];
    const people = await usersById(tx, [actor.id]);
    const requester = people.get(actor.id);
    const label = summary(
      request.leaveType.name,
      formatIsoDate(request.startDate),
      formatIsoDate(request.endDate),
      request.workingDays,
    );

    if (request.status === "PENDING" && formatIsoDate(request.startDate) > todayIso()) {
      const approval = await tx.approvalRequest.findFirst({
        where: { targetType: "LeaveRequest", targetId: request.id, type: "LEAVE", status: "PENDING" },
      });
      await tx.leaveRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
      if (approval) {
        await tx.approvalRequest.update({
          where: { id: approval.id },
          data: { status: "CANCELLED", decidedAt: new Date(), comment: "Cancelled by the employee." },
        });
        await auditStatus(tx, {
          actorId: actor.id,
          action: AUDIT_ACTIONS.LEAVE_CANCELLED,
          entityType: "ApprovalRequest",
          entityId: approval.id,
          before: { status: approval.status },
          after: { status: "CANCELLED" },
          reason: "Cancelled by the employee.",
          meta: input.meta,
        });
      }
      await releaseHold(tx, {
        actorId: actor.id,
        request,
        action: AUDIT_ACTIONS.LEAVE_CANCELLED,
        reason: "Cancelled by the employee.",
        meta: input.meta,
        key: `release:${request.id}`,
      });
      await auditStatus(tx, {
        actorId: actor.id,
        action: AUDIT_ACTIONS.LEAVE_CANCELLED,
        entityType: "LeaveRequest",
        entityId: request.id,
        before: { status: request.status },
        after: { status: "CANCELLED" },
        reason: "Cancelled by the employee.",
        meta: input.meta,
      });
      if (approval) {
        const approver = await tx.user.findUnique({
          where: { id: approval.approverId },
          select: { email: true },
        });
        await createNotification(tx, {
          userId: approval.approverId,
          title: "Leave request cancelled",
          body: `${requester?.name ?? "An employee"} cancelled ${label}.`,
          href: "/inbox",
        });
        if (approver) {
          mail.push({
            to: approver.email,
            subject: "Leave request cancelled",
            text: `${requester?.name ?? "An employee"} cancelled ${label}.`,
          });
        }
      }
      return { mail };
    }

    if (request.status !== "APPROVED" && !(request.status === "PENDING" && formatIsoDate(request.startDate) <= todayIso())) {
      throw new LeaveError("That leave request cannot be cancelled.");
    }

    const pending = await tx.approvalRequest.findFirst({
      where: { targetType: "LeaveRequest", targetId: request.id, type: "LEAVE", status: "PENDING" },
    });
    if (pending) {
      await tx.approvalRequest.update({
        where: { id: pending.id },
        data: { status: "CANCELLED", decidedAt: new Date(), comment: "Replaced by a cancellation request." },
      });
      await auditStatus(tx, {
        actorId: actor.id,
        action: AUDIT_ACTIONS.LEAVE_CANCELLED,
        entityType: "ApprovalRequest",
        entityId: pending.id,
        before: { status: "PENDING" },
        after: { status: "CANCELLED" },
        reason: "Replaced by a cancellation request.",
        meta: input.meta,
      });
    }
    const approverId = await resolveApprover(tx, actor.id);
    const approval = await tx.approvalRequest.create({
      data: {
        type: "LEAVE_CANCELLATION",
        targetType: "LeaveRequest",
        targetId: request.id,
        requesterId: actor.id,
        approverId,
        status: "PENDING",
      },
    });
    await tx.leaveRequest.update({ where: { id: request.id }, data: { status: "CANCELLATION_PENDING" } });
    await auditStatus(tx, {
      actorId: actor.id,
      action: AUDIT_ACTIONS.LEAVE_CANCELLED,
      entityType: "LeaveRequest",
      entityId: request.id,
      before: { status: request.status },
      after: { status: "CANCELLATION_PENDING" },
      meta: input.meta,
    });
    await auditStatus(tx, {
      actorId: actor.id,
      action: AUDIT_ACTIONS.LEAVE_CANCELLED,
      entityType: "ApprovalRequest",
      entityId: approval.id,
      before: null,
      after: { status: "PENDING", type: "LEAVE_CANCELLATION", approverId },
      meta: input.meta,
    });
    const approver = await tx.user.findUnique({ where: { id: approverId }, select: { email: true } });
    const body = `${requester?.name ?? "An employee"} asked to cancel ${label}.`;
    await createNotification(tx, {
      userId: approverId,
      title: "Leave cancellation",
      body,
      href: "/inbox",
    });
    if (approver) mail.push({ to: approver.email, subject: "Leave cancellation requested", text: body });
    if (requester) {
      mail.push({
        to: requester.email,
        subject: "Leave cancellation requested",
        text: `Your cancellation of ${label} is waiting for approval.`,
      });
    }
    return { mail };
  });

  await deliverMail(outcome.mail);
}

export async function decideLeaveApproval(input: {
  actorId: string;
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  comment?: string;
  meta?: AuditMeta;
}) {
  if (input.decision !== "APPROVED" && input.decision !== "REJECTED") {
    throw new LeaveError("Choose approve or reject.");
  }
  const comment = optionalComment(input.comment, input.decision === "REJECTED");
  await requireActiveActor(input.actorId);

  const outcome = await getDb().$transaction(async (tx) => {
    await lockApproval(tx, input.approvalId);
    const approval = await tx.approvalRequest.findUnique({ where: { id: input.approvalId } });
    if (!approval || approval.status !== "PENDING") {
      throw new LeaveError("That request is not pending.");
    }
    if (approval.targetType !== "LeaveRequest" || (approval.type !== "LEAVE" && approval.type !== "LEAVE_CANCELLATION")) {
      throw new LeaveError("That request is not a leave approval.");
    }
    await assertCanDecide(tx, input.actorId, approval);
    const request = await tx.leaveRequest.findUnique({
      where: { id: approval.targetId },
      include: { leaveType: true },
    });
    if (!request) throw new LeaveError("That leave request was not found.");
    await lockEmployee(tx, request.employeeId);

    const action = input.decision === "APPROVED" ? AUDIT_ACTIONS.LEAVE_APPROVED : AUDIT_ACTIONS.LEAVE_REJECTED;
    const label = summary(
      request.leaveType.name,
      formatIsoDate(request.startDate),
      formatIsoDate(request.endDate),
      request.workingDays,
    );
    let nextStatus: LeaveRequestStatus = request.status;
    const mail: MailMessage[] = [];

    if (approval.type === "LEAVE") {
      if (request.status !== "PENDING") throw new LeaveError("That leave request is not pending.");
      if (input.decision === "APPROVED") {
        await releaseHold(tx, {
          actorId: input.actorId,
          request,
          action,
          reason: comment,
          meta: input.meta,
          key: `release:${request.id}`,
        });
        await postLeaveLedger(tx, {
          actorId: input.actorId,
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          entryType: "DEDUCTION",
          days: request.workingDays.negated(),
          leaveRequestId: request.id,
          idempotencyKey: `deduction:${request.id}`,
          reason: comment,
          action,
          meta: input.meta,
        });
        nextStatus = "APPROVED";
      } else {
        await releaseHold(tx, {
          actorId: input.actorId,
          request,
          action,
          reason: comment,
          meta: input.meta,
          key: `release:${request.id}`,
        });
        nextStatus = "REJECTED";
      }
    } else if (input.decision === "APPROVED") {
      if (request.status !== "CANCELLATION_PENDING") {
        throw new LeaveError("That cancellation is not pending.");
      }
      const deduction = await tx.leaveLedger.findFirst({
        where: { leaveRequestId: request.id, entryType: "DEDUCTION" },
      });
      if (deduction) {
        await postLeaveLedger(tx, {
          actorId: input.actorId,
          employeeId: request.employeeId,
          leaveTypeId: request.leaveTypeId,
          entryType: "REVERSAL",
          days: deduction.days.negated(),
          leaveRequestId: request.id,
          reversesId: deduction.id,
          reason: comment ?? "Cancellation approved.",
          action: AUDIT_ACTIONS.LEAVE_CANCELLED,
          meta: input.meta,
        });
      } else {
        await releaseHold(tx, {
          actorId: input.actorId,
          request,
          action: AUDIT_ACTIONS.LEAVE_CANCELLED,
          reason: comment ?? "Cancellation approved.",
          meta: input.meta,
          key: `release:${request.id}`,
        });
      }
      nextStatus = "CANCELLED";
    } else {
      if (request.status !== "CANCELLATION_PENDING") {
        throw new LeaveError("That cancellation is not pending.");
      }
      const deduction = await tx.leaveLedger.findFirst({
        where: { leaveRequestId: request.id, entryType: "DEDUCTION" },
      });
      nextStatus = deduction ? "APPROVED" : "PENDING";
      if (!deduction) {
        const approverId = await resolveApprover(tx, request.employeeId);
        const restored = await tx.approvalRequest.create({
          data: {
            type: "LEAVE",
            targetType: "LeaveRequest",
            targetId: request.id,
            requesterId: request.employeeId,
            approverId,
            status: "PENDING",
          },
        });
        await auditStatus(tx, {
          actorId: input.actorId,
          action: AUDIT_ACTIONS.LEAVE_REQUESTED,
          entityType: "ApprovalRequest",
          entityId: restored.id,
          before: null,
          after: { status: "PENDING", type: "LEAVE", approverId },
          reason: "Cancellation was rejected.",
          meta: input.meta,
        });
        await createNotification(tx, {
          userId: approverId,
          title: "Leave request",
          body: `A cancellation was rejected. ${label} is pending again.`,
          href: "/inbox",
        });
      }
    }

    await tx.leaveRequest.update({ where: { id: request.id }, data: { status: nextStatus } });
    await tx.approvalRequest.update({
      where: { id: approval.id },
      data: { status: input.decision, comment, decidedAt: new Date() },
    });
    if (isEffectiveLeave(request.status) !== isEffectiveLeave(nextStatus)) {
      const days = await tx.leaveRequestDay.findMany({
        where: { leaveRequestId: request.id },
        select: { date: true },
      });
      await recomputeAttendance(tx, {
        dates: days.map((day) => formatIsoDate(day.date)),
        employeeIds: [request.employeeId],
        actorId: input.actorId,
        reason: `Leave ${nextStatus === "CANCELLED" ? "cancelled" : "approved"}: ${label}`,
        meta: input.meta,
      });
    }
    await auditStatus(tx, {
      actorId: input.actorId,
      action: nextStatus === "CANCELLED" ? AUDIT_ACTIONS.LEAVE_CANCELLED : action,
      entityType: "LeaveRequest",
      entityId: request.id,
      before: { status: request.status },
      after: { status: nextStatus },
      reason: comment,
      meta: input.meta,
    });
    await auditStatus(tx, {
      actorId: input.actorId,
      action: nextStatus === "CANCELLED" ? AUDIT_ACTIONS.LEAVE_CANCELLED : action,
      entityType: "ApprovalRequest",
      entityId: approval.id,
      before: { status: approval.status },
      after: { status: input.decision },
      reason: comment,
      meta: input.meta,
    });

    const requester = await tx.user.findUnique({
      where: { id: request.employeeId },
      select: { email: true, name: true },
    });
    const verb =
      nextStatus === "APPROVED"
        ? "approved"
        : nextStatus === "REJECTED"
          ? "rejected"
          : nextStatus === "CANCELLED"
            ? "cancelled"
            : "updated";
    const body = `Your ${label} was ${verb}.${comment ? ` Comment: ${comment}` : ""}`;
    await createNotification(tx, {
      userId: request.employeeId,
      title: `Leave ${verb}`,
      body,
      href: "/my-space/leave",
    });
    if (requester) {
      mail.push({ to: requester.email, subject: `Leave request ${verb}`, text: body });
    }
    return { mail };
  });

  await deliverMail(outcome.mail);
}

export async function adjustLeaveBalance(input: {
  actorId: string;
  employeeId: string;
  leaveTypeId: string;
  days: string;
  reason: string;
  meta?: AuditMeta;
}) {
  const actor = await requireLeaveAdmin(input.actorId);
  const reason = requiredText(input.reason, "Reason");
  const days = parseSignedDays(input.days);
  const employee = await getDb().employee.findUnique({ where: { id: input.employeeId } });
  if (!employee || (employee.status !== "ACTIVE" && employee.status !== "NOTICE")) {
    throw new LeaveError("Choose an active employee.");
  }
  const { leaveType, policy } = await loadType(getDb(), input.leaveTypeId);

  await getDb().$transaction(async (tx) => {
    await lockEmployee(tx, employee.id);
    if (policy.balanceEnforced) {
      const balance = await sumLeaveLedger(tx, employee.id, leaveType.id);
      if (balance.add(days).lessThan(0)) {
        throw new LeaveError("That would make the balance negative.");
      }
    }
    await postLeaveLedger(tx, {
      actorId: actor.id,
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      entryType: "ADJUSTMENT",
      days,
      reason,
      action: AUDIT_ACTIONS.LEAVE_BALANCE_ADJUSTED,
      meta: input.meta,
    });
  });
}

export async function reverseLedgerEntry(input: {
  actorId: string;
  ledgerId: string;
  reason: string;
  meta?: AuditMeta;
}) {
  const actor = await requireLeaveAdmin(input.actorId);
  const reason = requiredText(input.reason, "Reason");
  const existing = await getDb().leaveLedger.findUnique({
    where: { id: input.ledgerId },
    include: { reversedBy: true, leaveType: { include: { policy: true } } },
  });
  if (!existing) throw new LeaveError("That ledger entry was not found.");
  if (existing.reversedBy || existing.entryType === "REVERSAL") {
    throw new LeaveError("That entry has already been reversed.");
  }
  if (existing.entryType !== "ADJUSTMENT" && existing.entryType !== "ACCRUAL" && existing.entryType !== "CARRY_FORWARD") {
    throw new LeaveError("Reverse an accrual, carry-forward, or adjustment. Cancel the leave request to undo a booking.");
  }

  await getDb().$transaction(async (tx) => {
    await lockEmployee(tx, existing.employeeId);
    const current = await tx.leaveLedger.findUnique({
      where: { id: existing.id },
      include: { reversedBy: true },
    });
    if (!current || current.reversedBy) throw new LeaveError("That entry has already been reversed.");
    const days = current.days.negated();
    if (existing.leaveType.policy?.balanceEnforced) {
      const balance = await sumLeaveLedger(tx, existing.employeeId, existing.leaveTypeId);
      if (balance.add(days).lessThan(0)) {
        throw new LeaveError("That reversal would make the balance negative.");
      }
    }
    await postLeaveLedger(tx, {
      actorId: actor.id,
      employeeId: existing.employeeId,
      leaveTypeId: existing.leaveTypeId,
      entryType: "REVERSAL",
      days,
      reversesId: existing.id,
      reason,
      action: AUDIT_ACTIONS.LEAVE_REVERSED,
      meta: input.meta,
    });
  });
}

export async function listMyLeave(actorId: string): Promise<{
  balances: LeaveBalanceView[];
  history: LeaveHistoryView[];
}> {
  await requireActiveActor(actorId);
  const types = await getDb().leaveType.findMany({
    where: { isActive: true },
    include: { policy: true },
    orderBy: { sortOrder: "asc" },
  });
  const balances: LeaveBalanceView[] = [];
  for (const type of types) {
    const balance = await sumLeaveLedger(getDb(), actorId, type.id);
    balances.push({
      leaveTypeId: type.id,
      code: type.code,
      name: type.name,
      balance: balance.toFixed(2),
      halfDayAllowed: type.policy?.halfDayAllowed ?? false,
    });
  }

  const requests = await getDb().leaveRequest.findMany({
    where: { employeeId: actorId },
    include: { leaveType: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const approvals = await getDb().approvalRequest.findMany({
    where: { targetType: "LeaveRequest", targetId: { in: requests.map((request) => request.id) } },
    orderBy: { createdAt: "desc" },
  });
  const today = todayIso();
  const history: LeaveHistoryView[] = requests.map((request) => {
    const start = formatIsoDate(request.startDate);
    const comment = approvals.find((row) => row.targetId === request.id)?.comment ?? null;
    return {
      id: request.id,
      leaveType: request.leaveType.name,
      startDate: start,
      endDate: formatIsoDate(request.endDate),
      session: request.session,
      workingDays: request.workingDays.toFixed(2),
      status: request.status,
      reason: request.reason,
      comment,
      canCancelDirectly: request.status === "PENDING" && start > today,
      canRequestCancellation:
        request.status === "APPROVED" || (request.status === "PENDING" && start <= today),
    };
  });
  return { balances, history };
}

export async function listAllLeaveRequests(actorId: string): Promise<LeaveRequestView[]> {
  await requireLeaveAdmin(actorId);
  const rows = await getDb().leaveRequest.findMany({
    include: { employee: { select: { name: true, employeeCode: true } }, leaveType: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employee.name,
    employeeCode: row.employee.employeeCode,
    leaveType: row.leaveType.name,
    startDate: formatIsoDate(row.startDate),
    endDate: formatIsoDate(row.endDate),
    session: row.session,
    workingDays: row.workingDays.toFixed(2),
    status: row.status,
    reason: row.reason,
  }));
}

export async function listLedger(actorId: string, employeeId: string): Promise<LedgerView[]> {
  await requireLeaveAdmin(actorId);
  const rows = await getDb().leaveLedger.findMany({
    where: { employeeId },
    include: { leaveType: { select: { name: true } }, reversedBy: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    leaveType: row.leaveType.name,
    entryType: row.entryType,
    days: row.days.toFixed(2),
    reason: row.reason,
    createdAt: formatZonedDate(row.createdAt),
    canReverse:
      !row.reversedBy &&
      (row.entryType === "ADJUSTMENT" || row.entryType === "ACCRUAL" || row.entryType === "CARRY_FORWARD"),
  }));
}

export async function listLeaveEmployees(actorId: string) {
  await requireLeaveAdmin(actorId);
  return getDb().employee.findMany({
    where: { status: { in: ["ACTIVE", "NOTICE"] } },
    select: { id: true, name: true, employeeCode: true },
    orderBy: { name: "asc" },
  });
}

export async function listTeamLeave(actorId: string, month: string): Promise<Map<string, TeamLeaveEntry[]>> {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "team.view")) {
    throw new EmployeeAccessError("forbidden", "You cannot view this team.");
  }
  const grouped = new Map<string, TeamLeaveEntry[]>();
  if (actor.directReportIds.length === 0) return grouped;
  const start = parseIsoDate(`${month}-01`);
  const end = parseIsoDate(
    `${month}-${String(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`,
  );
  const rows = await getDb().leaveRequestDay.findMany({
    where: {
      employeeId: { in: [...actor.directReportIds] },
      date: { gte: start, lte: end },
      leaveRequest: { status: { in: ["PENDING", "APPROVED", "CANCELLATION_PENDING"] } },
    },
    include: {
      leaveRequest: {
        include: {
          employee: { select: { name: true } },
          leaveType: { select: { name: true } },
        },
      },
    },
    orderBy: { date: "asc" },
  });
  for (const row of rows) {
    const date = formatIsoDate(row.date);
    const list = grouped.get(date) ?? [];
    list.push({
      employeeId: row.employeeId,
      name: row.leaveRequest.employee.name,
      leaveType: row.leaveRequest.leaveType.name,
      status: row.leaveRequest.status,
      portion: row.portion.toFixed(2),
    });
    grouped.set(date, list);
  }
  return grouped;
}

export async function listTeamOverlap(requesterId: string, from: string, to: string): Promise<OverlapView[]> {
  const job = await openJob(getDb(), requesterId);
  if (!job?.reportingManagerId) return [];
  const peers = await getDb().employment.findMany({
    where: {
      reportingManagerId: job.reportingManagerId,
      endDate: null,
      employeeId: { not: requesterId },
      employee: { status: { in: ["ACTIVE", "NOTICE"] } },
    },
    select: { employeeId: true },
  });
  if (peers.length === 0) return [];
  const rows = await getDb().leaveRequestDay.findMany({
    where: {
      employeeId: { in: peers.map((peer) => peer.employeeId) },
      date: { gte: parseIsoDate(from), lte: parseIsoDate(to) },
      leaveRequest: { status: { in: [...OPEN_REQUEST] } },
    },
    include: {
      leaveRequest: {
        include: {
          employee: { select: { name: true } },
          leaveType: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }],
  });
  return rows.map((row) => ({
    name: row.leaveRequest.employee.name,
    date: formatIsoDate(row.date),
    leaveType: row.leaveRequest.leaveType.name,
    portion: row.portion.toFixed(2),
    status: row.leaveRequest.status,
  }));
}

export type InboxItem = {
  id: string;
  type: string;
  requesterName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  session: HalfSession | null;
  workingDays: string;
  reason: string;
  overlap: OverlapView[];
};

export async function loadInbox(userId: string): Promise<{
  approvals: InboxItem[];
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    href: string | null;
    createdAt: string;
    unread: boolean;
  }>;
}> {
  const approvals = await getDb().approvalRequest.findMany({
    where: { approverId: userId, status: "PENDING", targetType: "LeaveRequest" },
    include: { requester: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const requests = await getDb().leaveRequest.findMany({
    where: { id: { in: approvals.map((approval) => approval.targetId) } },
    include: { leaveType: { select: { name: true } } },
  });
  const byId = new Map(requests.map((request) => [request.id, request]));
  const items: InboxItem[] = [];
  for (const approval of approvals) {
    const request = byId.get(approval.targetId);
    if (!request) continue;
    const startDate = formatIsoDate(request.startDate);
    const endDate = formatIsoDate(request.endDate);
    items.push({
      id: approval.id,
      type: approval.type,
      requesterName: approval.requester.name,
      leaveType: request.leaveType.name,
      startDate,
      endDate,
      session: request.session,
      workingDays: request.workingDays.toFixed(2),
      reason: request.reason,
      overlap: await listTeamOverlap(request.employeeId, startDate, endDate),
    });
  }

  const notifications = await getDb().notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return {
    approvals: items,
    notifications: notifications.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      href: row.href,
      createdAt: row.createdAt.toISOString(),
      unread: row.readAt === null,
    })),
  };
}

export async function markNotificationsRead(userId: string) {
  await getDb().notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

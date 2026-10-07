import "dotenv/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { trackTestData } from "@/test/fixtures";
import { countLeaveDays } from "@/lib/leave-dates";
import { allowedEmailDomain } from "@/lib/services/auth-policy";
import { createEmployee } from "@/lib/services/employees";
import { LeaveError } from "@/lib/services/leave-errors";
import { createDepartment, createDesignation, createLocation } from "@/lib/services/organization";
import { resolveApprover } from "@/lib/services/approvals";
import { runLeaveAccrual, runLeaveCarryForward } from "@/lib/services/leave-jobs";
import { ensureLeaveCatalog } from "@/lib/services/leave-catalog";
import {
  adjustLeaveBalance,
  decideLeaveApproval,
  leaveBalance,
  submitLeaveRequest,
} from "@/lib/services/leave";

if (!process.env.EMPLOYEE_DATA_KEY) {
  process.env.EMPLOYEE_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
}

const WEEKEND = ["SATURDAY", "SUNDAY"];

describe("countLeaveDays", () => {
  it("skips the weekly off and holidays, and counts a half day as half", () => {
    const base = {
      weeklyOff: WEEKEND,
      excludeHolidays: true,
      halfDayAllowed: true,
    };
    const week = countLeaveDays({
      ...base,
      from: "2026-10-10",
      to: "2026-10-12",
      session: null,
      holidayDates: [],
      excludeWeekends: true,
    });
    assert.deepEqual(
      week.map((day) => day.date),
      ["2026-10-12"],
    );
    assert.equal(week[0]?.portion, "1.00");

    assert.throws(
      () =>
        countLeaveDays({
          ...base,
          from: "2026-10-10",
          to: "2026-10-12",
          session: null,
          holidayDates: ["2026-10-12"],
          excludeWeekends: true,
        }),
      /no working days/,
    );

    const half = countLeaveDays({
      ...base,
      from: "2026-10-12",
      to: "2026-10-12",
      session: "FIRST",
      holidayDates: [],
      excludeWeekends: true,
    });
    assert.equal(half.length, 1);
    assert.equal(half[0]?.portion, "0.50");
    assert.equal(half[0]?.session, "FIRST");

    const allDays = countLeaveDays({
      ...base,
      from: "2026-10-10",
      to: "2026-10-12",
      session: null,
      holidayDates: [],
      excludeWeekends: false,
    });
    assert.equal(allDays.length, 3);

    assert.throws(
      () =>
        countLeaveDays({
          ...base,
          from: "2026-10-12",
          to: "2026-10-13",
          session: "FIRST",
          holidayDates: [],
          excludeWeekends: true,
        }),
      /single date/,
    );
    assert.throws(
      () =>
        countLeaveDays({
          ...base,
          from: "2026-10-12",
          to: "2026-10-12",
          session: "SECOND",
          holidayDates: [],
          excludeWeekends: true,
          halfDayAllowed: false,
        }),
      /half day/,
    );
  });
});

describe("leave ledger, accrual, and approvers", () => {
  const { userIds, departmentIds, designationIds, locationIds } = trackTestData();

  async function insertUser(roles: Array<"SUPER_ADMIN" | "HR_ADMIN" | "MANAGER" | "EMPLOYEE">) {
    const domain = allowedEmailDomain();
    const user = await getDb().user.create({
      data: {
        name: "Leave test",
        email: `leave-${crypto.randomUUID()}@${domain}`,
        status: "ACTIVE",
        roles,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function masters(actorId: string) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const department = await createDepartment({ actorId, name: `Leave ${suffix}` });
    const designation = await createDesignation({ actorId, name: `Role ${suffix}` });
    const location = await createLocation({ actorId, name: `Site ${suffix}`, city: "Pune" });
    departmentIds.push(department.id);
    designationIds.push(designation.id);
    locationIds.push(location.id);
    return {
      suffix,
      departmentId: department.id,
      designationId: designation.id,
      locationId: location.id,
      employmentType: "FULL_TIME" as const,
      joiningDate: "2020-01-15",
      status: "ACTIVE" as const,
    };
  }

  async function typeId(code: string) {
    const row = await getDb().leaveType.findUnique({ where: { code } });
    assert.ok(row, code);
    return row.id;
  }

  async function summed(employeeId: string, leaveTypeId: string) {
    const rows = await getDb().leaveLedger.findMany({ where: { employeeId, leaveTypeId } });
    return rows.reduce((sum, row) => sum.add(row.days), new Prisma.Decimal(0));
  }

  it("keeps the balance equal to the sum of ledger entries", async () => {
    const domain = allowedEmailDomain();
    assert.ok(domain);
    await ensureLeaveCatalog();
    const hr = await insertUser(["HR_ADMIN", "EMPLOYEE"]);
    const job = await masters(hr.id);
    const employee = await createEmployee({
      actorId: hr.id,
      employeeCode: `L-${job.suffix}`,
      name: "Leela Leave",
      workEmail: `leela-${job.suffix}@${domain}`,
      ...job,
    });
    userIds.push(employee.id);
    const casual = await typeId("CASUAL");

    await adjustLeaveBalance({
      actorId: hr.id,
      employeeId: employee.id,
      leaveTypeId: casual,
      days: "10",
      reason: "Opening balance",
    });
    await submitLeaveRequest({
      actorId: employee.id,
      leaveTypeId: casual,
      startDate: "2026-10-12",
      endDate: "2026-10-13",
      session: "FULL",
      reason: "Family function",
    });

    const held = await leaveBalance(employee.id, casual);
    assert.equal(held.toFixed(2), "8.00");
    assert.equal((await summed(employee.id, casual)).toFixed(2), held.toFixed(2));

    const approval = await getDb().approvalRequest.findFirst({
      where: { requesterId: employee.id, type: "LEAVE", status: "PENDING" },
    });
    assert.ok(approval);
    await decideLeaveApproval({
      actorId: approval.approverId,
      approvalId: approval.id,
      decision: "APPROVED",
    });

    const after = await leaveBalance(employee.id, casual);
    assert.equal(after.toFixed(2), "8.00");
    assert.equal((await summed(employee.id, casual)).toFixed(2), after.toFixed(2));
    const kinds = await getDb().leaveLedger.findMany({
      where: { employeeId: employee.id, leaveTypeId: casual },
      select: { entryType: true },
    });
    const names = kinds.map((row) => row.entryType).sort();
    assert.deepEqual(names, ["ADJUSTMENT", "DEDUCTION", "HOLD", "RELEASE"]);
  });

  it("does not double-credit when accrual runs twice", async () => {
    const domain = allowedEmailDomain();
    assert.ok(domain);
    await ensureLeaveCatalog();
    const hr = await insertUser(["HR_ADMIN", "EMPLOYEE"]);
    const job = await masters(hr.id);
    const veteran = await createEmployee({
      actorId: hr.id,
      employeeCode: `V-${job.suffix}`,
      name: "Vikram Veteran",
      workEmail: `vikram-${job.suffix}@${domain}`,
      ...job,
    });
    const joiner = await createEmployee({
      actorId: hr.id,
      employeeCode: `J-${job.suffix}`,
      name: "Jaya Joiner",
      workEmail: `jaya-${job.suffix}@${domain}`,
      ...job,
      joiningDate: "2026-10-01",
    });
    userIds.push(veteran.id, joiner.id);
    const asOf = new Date("2026-10-07T04:00:00.000Z");
    const first = await runLeaveAccrual({ asOf, employeeIds: [veteran.id, joiner.id] });
    const casual = await typeId("CASUAL");
    const sick = await typeId("SICK");
    const earned = await typeId("EARNED");

    assert.equal((await leaveBalance(veteran.id, casual)).toFixed(2), "1.00");
    assert.equal((await leaveBalance(veteran.id, sick)).toFixed(2), "6.00");
    assert.equal((await leaveBalance(veteran.id, earned)).toFixed(2), "1.50");
    assert.equal((await leaveBalance(joiner.id, casual)).toFixed(2), "0.00");
    assert.equal((await leaveBalance(joiner.id, sick)).toFixed(2), "6.00");
    assert.equal((await leaveBalance(joiner.id, earned)).toFixed(2), "0.00");

    const second = await runLeaveAccrual({ asOf, employeeIds: [veteran.id, joiner.id] });
    assert.equal(second.credited, 0);
    assert.ok(first.credited > 0);
    assert.equal((await leaveBalance(veteran.id, casual)).toFixed(2), "1.00");
    assert.equal((await leaveBalance(veteran.id, sick)).toFixed(2), "6.00");
    assert.equal((await leaveBalance(joiner.id, sick)).toFixed(2), "6.00");
    assert.equal(
      await getDb().leaveLedger.count({
        where: { idempotencyKey: `accrual:${veteran.id}:${casual}:2026-10` },
      }),
      1,
    );
  });

  it("forfeits days above the carry cap once", async () => {
    const domain = allowedEmailDomain();
    assert.ok(domain);
    await ensureLeaveCatalog();
    const hr = await insertUser(["HR_ADMIN", "EMPLOYEE"]);
    const job = await masters(hr.id);
    const employee = await createEmployee({
      actorId: hr.id,
      employeeCode: `C-${job.suffix}`,
      name: "Cara Carry",
      workEmail: `cara-${job.suffix}@${domain}`,
      ...job,
    });
    userIds.push(employee.id);
    const earned = await typeId("EARNED");
    await adjustLeaveBalance({
      actorId: hr.id,
      employeeId: employee.id,
      leaveTypeId: earned,
      days: "15",
      reason: "Before year end",
    });
    await runLeaveCarryForward({ year: 2026, employeeIds: [employee.id] });
    assert.equal((await leaveBalance(employee.id, earned)).toFixed(2), "12.00");
    await runLeaveCarryForward({ year: 2026, employeeIds: [employee.id] });
    assert.equal((await leaveBalance(employee.id, earned)).toFixed(2), "12.00");
    const rows = await getDb().leaveLedger.findMany({
      where: { employeeId: employee.id, leaveTypeId: earned, entryType: "CARRY_FORWARD" },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.days.toFixed(2), "-3.00");
  });

  it("blocks self-approval and a manager acting on someone who does not report to them", async () => {
    const domain = allowedEmailDomain();
    assert.ok(domain);
    await ensureLeaveCatalog();
    const hr = await insertUser(["HR_ADMIN", "EMPLOYEE"]);
    const superAdmin = await insertUser(["SUPER_ADMIN", "EMPLOYEE"]);
    const job = await masters(hr.id);
    const manager = await createEmployee({
      actorId: hr.id,
      employeeCode: `M-${job.suffix}`,
      name: "Mina Manager",
      workEmail: `mina-${job.suffix}@${domain}`,
      ...job,
    });
    const other = await createEmployee({
      actorId: hr.id,
      employeeCode: `O-${job.suffix}`,
      name: "Omar Other",
      workEmail: `omar-${job.suffix}@${domain}`,
      ...job,
    });
    const report = await createEmployee({
      actorId: hr.id,
      employeeCode: `R-${job.suffix}`,
      name: "Ravi Report",
      workEmail: `ravi-${job.suffix}@${domain}`,
      reportingManagerId: manager.id,
      ...job,
    });
    const unmanaged = await createEmployee({
      actorId: hr.id,
      employeeCode: `U-${job.suffix}`,
      name: "Uma Unmanaged",
      workEmail: `uma-${job.suffix}@${domain}`,
      reportingManagerId: manager.id,
      ...job,
    });
    userIds.push(manager.id, other.id, report.id, unmanaged.id);

    assert.equal(await resolveApprover(getDb(), report.id), manager.id);
    assert.equal(await resolveApprover(getDb(), hr.id), superAdmin.id);

    await getDb().user.update({ where: { id: manager.id }, data: { status: "INACTIVE" } });
    const fallback = await resolveApprover(getDb(), unmanaged.id);
    assert.notEqual(fallback, unmanaged.id);
    assert.notEqual(fallback, manager.id);
    const fallbackUser = await getDb().user.findUniqueOrThrow({ where: { id: fallback } });
    assert.equal(fallbackUser.status, "ACTIVE");
    assert.equal(
      fallbackUser.roles.includes("HR_ADMIN") || fallbackUser.roles.includes("SUPER_ADMIN"),
      true,
    );
    await getDb().user.update({ where: { id: manager.id }, data: { status: "ACTIVE" } });

    const casual = await typeId("CASUAL");
    await adjustLeaveBalance({
      actorId: hr.id,
      employeeId: report.id,
      leaveTypeId: casual,
      days: "5",
      reason: "Opening balance",
    });
    await submitLeaveRequest({
      actorId: report.id,
      leaveTypeId: casual,
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      session: "FULL",
      reason: "Errand",
    });
    const approval = await getDb().approvalRequest.findFirstOrThrow({
      where: { requesterId: report.id, type: "LEAVE", status: "PENDING" },
    });
    assert.equal(approval.approverId, manager.id);

    await assert.rejects(
      () =>
        decideLeaveApproval({
          actorId: other.id,
          approvalId: approval.id,
          decision: "APPROVED",
        }),
      (error: unknown) => error instanceof LeaveError && /cannot act/.test(error.message),
    );

    await getDb().approvalRequest.update({
      where: { id: approval.id },
      data: { approverId: other.id },
    });
    await assert.rejects(
      () =>
        decideLeaveApproval({
          actorId: other.id,
          approvalId: approval.id,
          decision: "APPROVED",
        }),
      (error: unknown) => error instanceof LeaveError && /cannot act/.test(error.message),
    );

    await getDb().approvalRequest.update({
      where: { id: approval.id },
      data: { approverId: report.id },
    });
    await assert.rejects(
      () =>
        decideLeaveApproval({
          actorId: report.id,
          approvalId: approval.id,
          decision: "APPROVED",
        }),
      (error: unknown) => error instanceof LeaveError && /own request/.test(error.message),
    );

    await getDb().approvalRequest.update({
      where: { id: approval.id },
      data: { approverId: manager.id },
    });
    await assert.rejects(
      () =>
        decideLeaveApproval({
          actorId: manager.id,
          approvalId: approval.id,
          decision: "REJECTED",
        }),
      (error: unknown) => error instanceof LeaveError && /comment/.test(error.message),
    );
    const stillPending = await getDb().approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    assert.equal(stillPending.status, "PENDING");

    await decideLeaveApproval({
      actorId: manager.id,
      approvalId: approval.id,
      decision: "APPROVED",
    });
    const decided = await getDb().leaveRequest.findFirstOrThrow({ where: { employeeId: report.id } });
    assert.equal(decided.status, "APPROVED");
    assert.equal((await leaveBalance(report.id, casual)).toFixed(2), "4.00");
    assert.equal((await summed(report.id, casual)).toFixed(2), "4.00");
  });
});

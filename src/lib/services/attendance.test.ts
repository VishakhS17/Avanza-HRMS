import "dotenv/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { addDaysIso, parseIsoDate, todayIso } from "@/lib/leave-dates";
import {
  decideRegularization,
  getEmployeeAttendanceMonth,
  listTeamAttendance,
  overrideAttendance,
  recordPunch,
  runAttendanceDaily,
  submitRegularization,
} from "@/lib/services/attendance";
import { AttendanceError } from "@/lib/services/attendance-errors";
import { allowedEmailDomain } from "@/lib/services/auth-policy";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { changeEmployeeStatus, createEmployee } from "@/lib/services/employees";
import { createHoliday } from "@/lib/services/holidays";
import { ensureLeaveCatalog } from "@/lib/services/leave-catalog";
import { cancelLeaveRequest, decideLeaveApproval, submitLeaveRequest } from "@/lib/services/leave";
import { createDepartment, createDesignation, createLocation } from "@/lib/services/organization";
import { trackTestData } from "@/test/fixtures";

if (!process.env.EMPLOYEE_DATA_KEY) {
  process.env.EMPLOYEE_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
}

function ist(date: string, clock: string): Date {
  return new Date(`${date}T${clock}:00+05:30`);
}

describe("attendance", () => {
  const data = trackTestData();
  const { userIds, departmentIds, designationIds, locationIds } = data;

  /** HR, a manager, and two reports at a location with no weekly off, so every test day is a working day. */
  async function team() {
    const domain = allowedEmailDomain();
    const hr = await data.user(["HR_ADMIN", "EMPLOYEE"], "Attendance HR");
    const suffix = crypto.randomUUID().slice(0, 8);
    const department = await createDepartment({ actorId: hr.id, name: `Att ${suffix}` });
    const designation = await createDesignation({ actorId: hr.id, name: `Att role ${suffix}` });
    const location = await createLocation({ actorId: hr.id, name: `Att site ${suffix}`, city: "Pune" });
    departmentIds.push(department.id);
    designationIds.push(designation.id);
    locationIds.push(location.id);
    await getDb().location.update({ where: { id: location.id }, data: { weeklyOff: [] } });
    const base = {
      actorId: hr.id,
      departmentId: department.id,
      designationId: designation.id,
      locationId: location.id,
      employmentType: "FULL_TIME",
      joiningDate: "2020-01-15",
      status: "ACTIVE",
    };
    const person = async (code: string, name: string, extra: Record<string, unknown> = {}) => {
      const row = await createEmployee({
        ...base,
        employeeCode: `${code}-${suffix}`,
        name,
        workEmail: `${code.toLowerCase()}-${suffix}@${domain}`,
        ...extra,
      });
      userIds.push(row.id);
      return row;
    };
    const manager = await person("AM", "Asha Manager");
    const employee = await person("AE", "Eshan Employee", { reportingManagerId: manager.id });
    const peer = await person("AP", "Priya Peer", { reportingManagerId: manager.id });
    return { hr, manager, employee, peer, location };
  }

  async function record(employeeId: string, date: string) {
    return getDb().attendanceRecord.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: parseIsoDate(date) } },
    });
  }

  async function punch(employeeId: string, date: string, type: "CHECK_IN" | "CHECK_OUT", clock: string) {
    return getDb().attendanceEvent.create({
      data: { employeeId, workDate: parseIsoDate(date), type, timestamp: ist(date, clock), mode: "OFFICE" },
    });
  }

  async function pendingApproval(requesterId: string, type: string) {
    const approval = await getDb().approvalRequest.findFirst({ where: { requesterId, type, status: "PENDING" } });
    assert.ok(approval, `pending ${type}`);
    return approval;
  }

  it("the app role cannot update, delete, or truncate punches", async () => {
    const { employee } = await team();
    const event = await punch(employee.id, addDaysIso(todayIso(), -1), "CHECK_IN", "09:30");
    const [privileges] = await getDb().$queryRaw<
      Array<{ ins: boolean; sel: boolean; upd: boolean; del: boolean; trunc: boolean }>
    >`
      SELECT has_table_privilege(current_user, 'attendance_events', 'INSERT') AS ins,
             has_table_privilege(current_user, 'attendance_events', 'SELECT') AS sel,
             has_table_privilege(current_user, 'attendance_events', 'UPDATE') AS upd,
             has_table_privilege(current_user, 'attendance_events', 'DELETE') AS del,
             has_table_privilege(current_user, 'attendance_events', 'TRUNCATE') AS trunc
    `;
    assert.deepEqual(privileges, { ins: true, sel: true, upd: false, del: false, trunc: false });
    await assert.rejects(
      getDb().$executeRaw`UPDATE attendance_events SET "timestamp" = now() WHERE id = ${event.id}`,
      /permission denied/,
    );
    await assert.rejects(getDb().$executeRaw`DELETE FROM attendance_events WHERE id = ${event.id}`, /permission denied/);
    await assert.rejects(getDb().$executeRawUnsafe("TRUNCATE attendance_events"), /permission denied/);
    await assert.rejects(
      getDb().attendanceEvent.update({ where: { id: event.id }, data: { mode: "WFH" } }),
      /append-only/,
    );
    assert.equal(await getDb().attendanceEvent.count({ where: { id: event.id } }), 1);
  });

  it("serializes two simultaneous check-ins into one punch", async () => {
    const { employee } = await team();
    const results = await Promise.allSettled([
      recordPunch({ actorId: employee.id, type: "CHECK_IN", mode: "OFFICE" }),
      recordPunch({ actorId: employee.id, type: "CHECK_IN", mode: "OFFICE" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.match(String(rejected.reason?.message), /already checked in/);
    assert.equal(await getDb().attendanceEvent.count({ where: { employeeId: employee.id } }), 1);

    await recordPunch({ actorId: employee.id, type: "CHECK_OUT" });
    await assert.rejects(recordPunch({ actorId: employee.id, type: "CHECK_OUT" }), /not checked in/);
    assert.equal(await getDb().attendanceEvent.count({ where: { employeeId: employee.id } }), 2);
  });

  it("an open check-in from an earlier day does not block today's check-in", async () => {
    const { employee } = await team();
    const earlier = addDaysIso(todayIso(), -2);
    await punch(employee.id, earlier, "CHECK_IN", "09:30");
    const today = await recordPunch({ actorId: employee.id, type: "CHECK_IN" });
    assert.notEqual(today.workDate, earlier);
    await runAttendanceDaily({ date: earlier });
    const stale = await record(employee.id, earlier);
    assert.equal(stale?.status, "INCOMPLETE");
    assert.deepEqual(stale?.flags, ["INCOMPLETE"]);
  });

  it("job scope: joined on or before the date and not exited before it", async () => {
    const { hr, manager, employee, peer } = await team();
    const day = addDaysIso(todayIso(), -2);
    await changeEmployeeStatus({ actorId: hr.id, employeeId: peer.id, status: "EXITED" });
    const exited = await getDb().employee.findUnique({ where: { id: peer.id } });
    assert.equal(exited?.exitDate?.toISOString().slice(0, 10), todayIso());
    await getDb().employee.update({
      where: { id: employee.id },
      data: { status: "EXITED", exitDate: parseIsoDate(addDaysIso(day, -1)) },
    });
    await getDb().employee.update({ where: { id: manager.id }, data: { joiningDate: parseIsoDate(addDaysIso(day, 1)) } });

    await runAttendanceDaily({ date: day });
    assert.equal((await record(peer.id, day))?.status, "ABSENT");
    assert.equal(await record(employee.id, day), null);
    assert.equal(await record(manager.id, day), null);
  });

  it("catches up every missed day and is idempotent", async () => {
    const { employee } = await team();
    const first = await runAttendanceDaily({ now: ist("2026-09-05", "12:00") });
    assert.deepEqual(first.dates, ["2026-09-04"]);
    assert.equal((await record(employee.id, "2026-09-04"))?.status, "ABSENT");

    const catchUp = await runAttendanceDaily({ now: ist("2026-09-09", "12:00") });
    assert.deepEqual(catchUp.dates, ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
    for (const date of catchUp.dates) {
      assert.equal((await record(employee.id, date))?.status, "ABSENT", date);
    }

    const auditBefore = await getDb().auditLog.count({ where: { action: "ATTENDANCE_RECORDED" } });
    const again = await runAttendanceDaily({ now: ist("2026-09-09", "12:00") });
    assert.equal(again.created, 0);
    assert.equal(again.updated, 0);
    assert.ok(again.unchanged > 0);
    assert.equal(await getDb().auditLog.count({ where: { action: "ATTENDANCE_RECORDED" } }), auditBefore);
    assert.equal(
      await getDb().attendanceRecord.count({ where: { employeeId: employee.id } }),
      5,
    );
  });

  it("approved backdated leave turns ABSENT into ON_LEAVE, and approved cancellation turns it back", async () => {
    const { manager, employee } = await team();
    await ensureLeaveCatalog();
    const lop = await getDb().leaveType.findUnique({ where: { code: "LOP" } });
    assert.ok(lop);
    const day = addDaysIso(todayIso(), -2);
    await runAttendanceDaily({ date: day });
    assert.equal((await record(employee.id, day))?.status, "ABSENT");

    await submitLeaveRequest({
      actorId: employee.id,
      leaveTypeId: lop.id,
      startDate: day,
      endDate: day,
      session: "FULL",
      reason: "Was unwell",
    });
    assert.equal((await record(employee.id, day))?.status, "ABSENT");
    const approval = await pendingApproval(employee.id, "LEAVE");
    await decideLeaveApproval({ actorId: manager.id, approvalId: approval.id, decision: "APPROVED" });
    assert.equal((await record(employee.id, day))?.status, "ON_LEAVE");

    const request = await getDb().leaveRequest.findFirst({ where: { employeeId: employee.id } });
    assert.ok(request);
    await cancelLeaveRequest({ actorId: employee.id, requestId: request.id });
    assert.equal((await record(employee.id, day))?.status, "ON_LEAVE");
    const cancellation = await pendingApproval(employee.id, "LEAVE_CANCELLATION");
    await decideLeaveApproval({ actorId: manager.id, approvalId: cancellation.id, decision: "APPROVED" });
    assert.equal((await record(employee.id, day))?.status, "ABSENT");
  });

  it("a new holiday recomputes stored days at that location", async () => {
    const { hr, employee, location } = await team();
    const day = addDaysIso(todayIso(), -2);
    await runAttendanceDaily({ date: day });
    assert.equal((await record(employee.id, day))?.status, "ABSENT");
    await createHoliday({ actorId: hr.id, locationId: location.id, date: day, name: "Test holiday" });
    assert.equal((await record(employee.id, day))?.status, "HOLIDAY");
  });

  it("an approved regularization updates the record and keeps the original punches", async () => {
    const { manager, employee } = await team();
    const day = addDaysIso(todayIso(), -2);
    await punch(employee.id, day, "CHECK_IN", "09:40");
    await runAttendanceDaily({ date: day });
    assert.equal((await record(employee.id, day))?.status, "INCOMPLETE");

    const { id } = await submitRegularization({
      actorId: employee.id,
      workDate: day,
      inTime: "09:30",
      outTime: "18:30",
      reason: "Forgot to check out",
    });
    await assert.rejects(
      submitRegularization({ actorId: employee.id, workDate: day, inTime: "09:30", outTime: "18:30", reason: "Again" }),
      /already have a pending/,
    );
    const approval = await pendingApproval(employee.id, "ATTENDANCE_REGULARIZATION");
    await assert.rejects(
      decideRegularization({ actorId: employee.id, approvalId: approval.id, decision: "APPROVED" }),
      /your own request/,
    );
    await decideRegularization({ actorId: manager.id, approvalId: approval.id, decision: "APPROVED" });

    const updated = await record(employee.id, day);
    assert.equal(updated?.status, "PRESENT");
    assert.equal(updated?.regularizationId, id);
    assert.equal(updated?.workedMinutes, 540);
    const events = await getDb().attendanceEvent.findMany({ where: { employeeId: employee.id } });
    assert.equal(events.length, 1);
    assert.equal(events[0].timestamp.toISOString(), ist(day, "09:40").toISOString());
    const audit = await getDb().auditLog.findFirst({
      where: { action: "ATTENDANCE_REGULARIZATION_APPROVED", entityType: "AttendanceRecord", entityId: updated!.id },
    });
    assert.ok(audit);
    assert.equal((audit.before as { status: string }).status, "INCOMPLETE");
    assert.equal((audit.after as { status: string }).status, "PRESENT");

    const rerun = await runAttendanceDaily({ date: day });
    assert.equal(rerun.skipped, 1);
    assert.equal((await record(employee.id, day))?.status, "PRESENT");
  });

  it("validates regularization times and the 7-day window", async () => {
    const { employee } = await team();
    const day = addDaysIso(todayIso(), -2);
    const submit = (input: Partial<{ workDate: string; inTime: string; outTime: string }>) =>
      submitRegularization({
        actorId: employee.id,
        workDate: day,
        inTime: "09:30",
        outTime: "18:30",
        reason: "Fix",
        ...input,
      });
    await assert.rejects(submit({ inTime: "18:30", outTime: "09:30" }), /after check-in/);
    await assert.rejects(submit({ workDate: addDaysIso(todayIso(), -8) }), /7 days/);
    await assert.rejects(submit({ workDate: addDaysIso(todayIso(), 1) }), /7 days/);
    await assert.rejects(
      submitRegularization({
        actorId: employee.id,
        workDate: "2026-10-07",
        inTime: "09:30",
        outTime: "18:30",
        reason: "Fix",
        now: ist("2026-10-07", "12:00"),
      }),
      /future/,
    );
  });

  it("a locked month rejects employee submissions and manager approvals, but HR can override", async () => {
    const { hr, manager, employee } = await team();
    const day = "2026-09-30";
    await assert.rejects(
      submitRegularization({
        actorId: employee.id,
        workDate: day,
        inTime: "09:30",
        outTime: "18:30",
        reason: "Late fix",
        now: ist("2026-10-05", "12:00"),
      }),
      (error: unknown) => error instanceof AttendanceError && /locked/.test(error.message),
    );

    await submitRegularization({
      actorId: employee.id,
      workDate: day,
      inTime: "09:30",
      outTime: "18:30",
      reason: "Before the lock",
      now: ist("2026-10-02", "12:00"),
    });
    const approval = await pendingApproval(employee.id, "ATTENDANCE_REGULARIZATION");
    await assert.rejects(
      decideRegularization({
        actorId: manager.id,
        approvalId: approval.id,
        decision: "APPROVED",
        now: ist("2026-10-05", "12:00"),
      }),
      /locked/,
    );
    assert.equal(await record(employee.id, day), null);
    await decideRegularization({
      actorId: manager.id,
      approvalId: approval.id,
      decision: "REJECTED",
      comment: "Month closed",
      now: ist("2026-10-05", "12:00"),
    });

    await assert.rejects(
      overrideAttendance({ actorId: manager.id, employeeId: employee.id, workDate: day, status: "PRESENT", reason: "x" }),
      EmployeeAccessError,
    );
    await assert.rejects(
      overrideAttendance({ actorId: hr.id, employeeId: employee.id, workDate: day, status: "PRESENT", reason: " " }),
      /Reason/,
    );
    await overrideAttendance({
      actorId: hr.id,
      employeeId: employee.id,
      workDate: day,
      status: "PRESENT",
      inTime: "09:30",
      outTime: "18:30",
      reason: "Client visit confirmed",
    });
    const overridden = await record(employee.id, day);
    assert.equal(overridden?.status, "PRESENT");
    assert.equal(overridden?.overriddenById, hr.id);
    const audit = await getDb().auditLog.findFirst({
      where: { action: "ATTENDANCE_OVERRIDDEN", entityId: overridden!.id },
    });
    assert.equal(audit?.reason, "Client visit confirmed");
    assert.equal(audit?.before, null);
    assert.equal((audit?.after as { status: string }).status, "PRESENT");
  });

  it("HR cannot override their own attendance", async () => {
    const { hr } = await team();
    await assert.rejects(
      overrideAttendance({
        actorId: hr.id,
        employeeId: hr.id,
        workDate: addDaysIso(todayIso(), -1),
        status: "PRESENT",
        reason: "Self",
      }),
      /your own/,
    );
  });

  it("managers see only their direct reports", async () => {
    const first = await team();
    const second = await team();
    const { rows } = await listTeamAttendance(first.manager.id, addDaysIso(todayIso(), -1));
    assert.deepEqual(
      rows.map((row) => row.employeeId).sort(),
      [first.employee.id, first.peer.id].sort(),
    );
    const view = await getEmployeeAttendanceMonth(first.manager.id, first.employee.id);
    assert.ok(view.days.length >= 28);
    await assert.rejects(
      getEmployeeAttendanceMonth(first.manager.id, second.employee.id),
      EmployeeAccessError,
    );
    await assert.rejects(getEmployeeAttendanceMonth(first.employee.id, first.peer.id), EmployeeAccessError);
  });
});

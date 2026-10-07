import "dotenv/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { parseIsoDate, todayIso } from "@/lib/leave-dates";
import { AUDIT_ACTIONS } from "@/lib/services/audit";
import { allowedEmailDomain } from "@/lib/services/auth-policy";
import { loadHomeDashboard } from "@/lib/services/dashboard";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { changeEmployeeStatus, createEmployee } from "@/lib/services/employees";
import { ensureLeaveCatalog } from "@/lib/services/leave-catalog";
import { adjustLeaveBalance } from "@/lib/services/leave";
import { createDepartment, createDesignation, createLocation } from "@/lib/services/organization";
import {
  exportReport,
  isoWeekRange,
  loadReport,
  parseReportSearch,
} from "@/lib/services/reports";
import { trackTestData } from "@/test/fixtures";

if (!process.env.EMPLOYEE_DATA_KEY) {
  process.env.EMPLOYEE_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
}

describe("isoWeekRange", () => {
  it("returns Monday to Sunday for the IST week", () => {
    assert.deepEqual(isoWeekRange("2026-10-07"), { from: "2026-10-05", to: "2026-10-11" });
    assert.deepEqual(isoWeekRange("2026-10-05"), { from: "2026-10-05", to: "2026-10-11" });
    assert.deepEqual(isoWeekRange("2026-10-11"), { from: "2026-10-05", to: "2026-10-11" });
  });
});

describe("reports and dashboards", () => {
  const data = trackTestData();
  const { userIds, departmentIds, designationIds, locationIds } = data;

  async function team() {
    const domain = allowedEmailDomain();
    const hr = await data.user(["HR_ADMIN", "EMPLOYEE"], "Reports HR");
    const suffix = crypto.randomUUID().slice(0, 8);
    const department = await createDepartment({ actorId: hr.id, name: `Rep ${suffix}` });
    const otherDept = await createDepartment({ actorId: hr.id, name: `Rep other ${suffix}` });
    const designation = await createDesignation({ actorId: hr.id, name: `Rep role ${suffix}` });
    const location = await createLocation({ actorId: hr.id, name: `Rep site ${suffix}`, city: "Pune" });
    departmentIds.push(department.id, otherDept.id);
    designationIds.push(designation.id);
    locationIds.push(location.id);
    await getDb().location.update({ where: { id: location.id }, data: { weeklyOff: [] } });
    const base = {
      actorId: hr.id,
      designationId: designation.id,
      locationId: location.id,
      employmentType: "FULL_TIME" as const,
      joiningDate: "2020-01-15",
      status: "ACTIVE",
    };
    const person = async (
      code: string,
      name: string,
      extra: Record<string, unknown> = {},
      departmentId = department.id,
    ) => {
      const row = await createEmployee({
        ...base,
        departmentId,
        employeeCode: `${code}-${suffix}`,
        name,
        workEmail: `${code.toLowerCase()}-${suffix}@${domain}`,
        ...extra,
      });
      userIds.push(row.id);
      return row;
    };
    const manager = await person("RM", "Rina Manager");
    const report = await person("RA", "Arun Report", { reportingManagerId: manager.id });
    const outsider = await person("RO", "Omar Outsider", {}, otherDept.id);
    return { hr, manager, report, outsider, department, otherDept, location };
  }

  it("rejects employees and scopes managers to direct reports", async () => {
    const { hr, manager, report, outsider, department } = await team();
    await ensureLeaveCatalog();
    const casual = await getDb().leaveType.findFirst({ where: { code: "CASUAL" } });
    assert.ok(casual);
    await adjustLeaveBalance({
      actorId: hr.id,
      employeeId: report.id,
      leaveTypeId: casual.id,
      days: "2.00",
      reason: "Test credit for report",
    });
    await adjustLeaveBalance({
      actorId: hr.id,
      employeeId: outsider.id,
      leaveTypeId: casual.id,
      days: "9.00",
      reason: "Test credit for outsider",
    });

    await assert.rejects(loadReport(report.id, parseReportSearch({})), (error: unknown) => {
      assert.ok(error instanceof EmployeeAccessError);
      assert.equal(error.kind, "forbidden");
      return true;
    });

    const managerHeadcount = await loadReport(manager.id, parseReportSearch({ type: "headcount", groupBy: "department" }));
    assert.equal(managerHeadcount.table.rows.length, 1);
    assert.equal(managerHeadcount.table.rows[0]?.group, department.name);
    assert.equal(managerHeadcount.table.rows[0]?.active, "1");
    assert.ok(managerHeadcount.departments.every((row) => row.id === department.id));
    assert.equal(managerHeadcount.departments.some((row) => row.id !== department.id), false);

    const managerBalances = await loadReport(manager.id, parseReportSearch({ type: "leave-balances" }));
    const names = managerBalances.table.rows.map((row) => row.name);
    assert.deepEqual(names, ["Arun Report"]);
    assert.equal(managerBalances.table.rows[0]?.CASUAL, "2.00");

    const hrHeadcount = await loadReport(hr.id, parseReportSearch({ type: "headcount", groupBy: "department" }));
    const hrNames = hrHeadcount.table.rows.map((row) => row.group).sort();
    assert.ok(hrNames.includes(department.name));
    const deptRow = hrHeadcount.table.rows.find((row) => row.group === department.name);
    assert.ok(Number(deptRow?.active ?? 0) >= 2);

    const hrBalances = await loadReport(hr.id, parseReportSearch({ type: "leave-balances" }));
    const hrPeople = hrBalances.table.rows.map((row) => row.name);
    assert.ok(hrPeople.includes("Arun Report"));
    assert.ok(hrPeople.includes("Omar Outsider"));
    assert.ok(hrPeople.includes("Rina Manager"));
  });

  it("keeps daily and monthly attendance inside the manager's team", async () => {
    const { manager, report, outsider } = await team();
    const month = "2026-09";
    await getDb().attendanceRecord.createMany({
      data: [
        {
          employeeId: report.id,
          workDate: parseIsoDate("2026-09-01"),
          status: "PRESENT",
          flags: ["LATE"],
          workedMinutes: 480,
        },
        {
          employeeId: outsider.id,
          workDate: parseIsoDate("2026-09-01"),
          status: "ABSENT",
          flags: [],
          workedMinutes: 0,
        },
      ],
    });
    const monthly = await loadReport(manager.id, parseReportSearch({ type: "attendance-monthly", month }));
    assert.equal(monthly.table.rows.length, 1);
    assert.equal(monthly.table.rows[0]?.name, "Arun Report");
    assert.equal(monthly.table.rows[0]?.present, "1");
    assert.equal(monthly.table.rows[0]?.late, "1");

    const daily = await loadReport(
      manager.id,
      parseReportSearch({ type: "attendance-daily", date: todayIso() }),
    );
    const dailyNames = daily.table.rows.map((row) => row.name);
    assert.ok(dailyNames.includes("Arun Report"));
    assert.equal(dailyNames.includes("Omar Outsider"), false);
  });

  it("audits CSV export and uses the same rows as the viewer", async () => {
    const { manager } = await team();
    const search = parseReportSearch({ type: "leave-balances" });
    const page = await loadReport(manager.id, search);
    const exported = await exportReport({ actorId: manager.id, search });
    assert.match(exported.filename, /leave-balances/);
    assert.match(exported.csv, /Arun Report/);
    assert.equal(exported.csv.includes("Omar Outsider"), false);
    assert.equal(exported.rowCount, page.table.rows.length);
    const auditRow = await getDb().auditLog.findFirst({
      where: { actorUserId: manager.id, action: AUDIT_ACTIONS.REPORT_EXPORTED, entityId: "leave-balances" },
      orderBy: { timestamp: "desc" },
    });
    assert.ok(auditRow);
  });

  it("shows manager widgets for the team only and HR widgets company-wide", async () => {
    const { hr, manager, report, outsider } = await team();
    const today = todayIso();
    const casual = await getDb().leaveType.findFirst({ where: { isActive: true } });
    assert.ok(casual);
    await getDb().leaveRequest.create({
      data: {
        employeeId: outsider.id,
        leaveTypeId: casual.id,
        startDate: parseIsoDate(today),
        endDate: parseIsoDate(today),
        reason: "Outsider leave",
        status: "APPROVED",
        workingDays: 1,
      },
    });
    await getDb().leaveRequest.create({
      data: {
        employeeId: report.id,
        leaveTypeId: casual.id,
        startDate: parseIsoDate(today),
        endDate: parseIsoDate(today),
        reason: "Report leave",
        status: "APPROVED",
        workingDays: 1,
      },
    });

    const employeeDash = await loadHomeDashboard(report.id);
    assert.equal(employeeDash.manager, null);
    assert.equal(employeeDash.hr, null);
    assert.ok(employeeDash.punch);

    const managerDash = await loadHomeDashboard(manager.id);
    assert.ok(managerDash.manager);
    assert.equal(managerDash.hr, null);
    assert.ok(managerDash.manager.outToday.some((row) => row.employeeId === report.id));
    assert.equal(managerDash.manager.outToday.some((row) => row.employeeId === outsider.id), false);

    await changeEmployeeStatus({ actorId: hr.id, employeeId: outsider.id, status: "EXITED" });
    const hrDash = await loadHomeDashboard(hr.id);
    assert.ok(hrDash.hr);
    assert.equal(hrDash.manager, null);
    assert.ok(hrDash.hr.exitsThisMonth.some((row) => row.id === outsider.id));
    assert.ok(hrDash.hr.headcount.some((row) => row.status === "ACTIVE" && row.count >= 2));
    assert.ok(hrDash.hr.pendingActions.some((row) => row.href === "/people?status=PRE_JOINING"));
  });
});

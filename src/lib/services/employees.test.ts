import "dotenv/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { trackTestData } from "@/test/fixtures";
import { buildPrincipal } from "@/lib/permissions";
import { allowedEmailDomain } from "@/lib/services/auth-policy";
import {
  changeEmployment,
  createEmployee,
  readEmployeeApi,
  revealSensitiveField,
} from "@/lib/services/employees";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { createDepartment, createDesignation, createLocation } from "@/lib/services/organization";
import { listDirectReportIds, reportingCycleError } from "@/lib/services/reporting";

if (!process.env.EMPLOYEE_DATA_KEY) {
  process.env.EMPLOYEE_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
}

describe("reportingCycleError", () => {
  const chain = new Map<string, string | null>([
    ["a", null],
    ["b", "a"],
    ["c", "b"],
  ]);

  it("rejects a self report and a cycle up the current line", () => {
    assert.match(reportingCycleError("a", "a", chain) ?? "", /themselves/);
    assert.match(reportingCycleError("a", "c", chain) ?? "", /cycle/);
    assert.equal(reportingCycleError("c", "a", chain), null);
    assert.equal(reportingCycleError("b", null, chain), null);
  });
});

describe("employee scope and job history", () => {
  const { userIds, departmentIds, designationIds, locationIds } = trackTestData();

  async function insertUser(roles: Array<"SUPER_ADMIN" | "HR_ADMIN" | "MANAGER" | "EMPLOYEE">) {
    const domain = allowedEmailDomain();
    const user = await getDb().user.create({
      data: {
        name: "Scope test",
        email: `scope-${crypto.randomUUID()}@${domain}`,
        status: "ACTIVE",
        roles,
      },
    });
    userIds.push(user.id);
    return user;
  }

  it("scopes direct reports, blocks cycles, and keeps job history", async () => {
    const domain = allowedEmailDomain();
    assert.ok(domain, "AUTH_ALLOWED_EMAIL_DOMAIN is required for this test");
    const hr = await insertUser(["HR_ADMIN", "EMPLOYEE"]);
    const suffix = crypto.randomUUID().slice(0, 8);
    const department = await createDepartment({ actorId: hr.id, name: `Ops ${suffix}` });
    const designation = await createDesignation({ actorId: hr.id, name: `Lead ${suffix}` });
    const location = await createLocation({ actorId: hr.id, name: `Pune ${suffix}`, city: "Pune" });
    departmentIds.push(department.id);
    designationIds.push(designation.id);
    locationIds.push(location.id);

    const job = {
      departmentId: department.id,
      designationId: designation.id,
      locationId: location.id,
      employmentType: "FULL_TIME",
      joiningDate: "2020-01-15",
      status: "ACTIVE",
    };

    const manager = await createEmployee({
      actorId: hr.id,
      employeeCode: `M-${suffix}`,
      name: "Mina Manager",
      workEmail: `mina-${suffix}@${domain}`,
      ...job,
    });
    const report = await createEmployee({
      actorId: hr.id,
      employeeCode: `R-${suffix}`,
      name: "Ravi Report",
      workEmail: `ravi-${suffix}@${domain}`,
      reportingManagerId: manager.id,
      sensitive: { pan: "ABCDE1234F" },
      ...job,
    });
    const other = await createEmployee({
      actorId: hr.id,
      employeeCode: `O-${suffix}`,
      name: "Omar Other",
      workEmail: `omar-${suffix}@${domain}`,
      ...job,
    });
    userIds.push(manager.id, report.id, other.id);

    const reportIds = await listDirectReportIds(manager.id);
    assert.deepEqual(reportIds, [report.id]);

    const managerPrincipal = buildPrincipal({
      id: manager.id,
      assignedRoles: ["EMPLOYEE"],
      directReportIds: reportIds,
    });
    const otherPrincipal = buildPrincipal({ id: other.id, assignedRoles: ["EMPLOYEE"] });
    const hrPrincipal = buildPrincipal({ id: hr.id, assignedRoles: ["HR_ADMIN"] });

    const reportResponse = await readEmployeeApi(managerPrincipal, report.id);
    assert.equal(reportResponse.status, 200);
    const reportBody = await reportResponse.json();
    assert.equal(reportBody.personal, null);
    assert.equal(JSON.stringify(reportBody).includes("ABCDE1234F"), false);

    const outsiderResponse = await readEmployeeApi(managerPrincipal, other.id);
    assert.equal(outsiderResponse.status, 403);

    const peerResponse = await readEmployeeApi(otherPrincipal, report.id);
    assert.equal(peerResponse.status, 403);

    const hrResponse = await readEmployeeApi(hrPrincipal, report.id);
    assert.equal(hrResponse.status, 200);
    const hrBody = await hrResponse.json();
    assert.equal(hrBody.personal.sensitive.pan, "••••234F");
    assert.equal(JSON.stringify(hrBody).includes("ABCDE1234F"), false);

    await assert.rejects(
      () => revealSensitiveField({ actorId: manager.id, employeeId: report.id, field: "pan" }),
      (error: unknown) => error instanceof EmployeeAccessError && /HR Admin/.test(error.message),
    );

    const revealed = await revealSensitiveField({
      actorId: hr.id,
      employeeId: report.id,
      field: "pan",
    });
    assert.equal(revealed, "ABCDE1234F");
    const auditRow = await getDb().auditLog.findFirst({
      where: { entityId: report.id, action: "SENSITIVE_FIELD_REVEALED" },
      orderBy: { timestamp: "desc" },
    });
    assert.ok(auditRow);
    assert.equal(JSON.stringify(auditRow.after).includes("ABCDE1234F"), false);
    assert.equal(JSON.stringify(auditRow.before ?? {}).includes("ABCDE1234F"), false);

    const below = await createEmployee({
      actorId: hr.id,
      employeeCode: `C-${suffix}`,
      name: "Cara Chain",
      workEmail: `cara-${suffix}@${domain}`,
      reportingManagerId: report.id,
      ...job,
    });
    userIds.push(below.id);

    await assert.rejects(
      () =>
        changeEmployment({
          actorId: hr.id,
          employeeId: manager.id,
          ...job,
          reportingManagerId: below.id,
          startDate: "2024-02-01",
        }),
      /cycle/,
    );
    const managerJobs = await getDb().employment.count({ where: { employeeId: manager.id } });
    assert.equal(managerJobs, 1);

    await changeEmployment({
      actorId: hr.id,
      employeeId: below.id,
      ...job,
      reportingManagerId: manager.id,
      startDate: "2024-02-01",
    });
    const history = await getDb().employment.findMany({
      where: { employeeId: below.id },
      orderBy: { startDate: "asc" },
    });
    assert.equal(history.length, 2);
    assert.equal(history[0]?.endDate?.toISOString().slice(0, 10), "2024-01-31");
    assert.equal(history[0]?.openKey, null);
    assert.equal(history[1]?.endDate, null);
    assert.equal(history[1]?.openKey, below.id);
    assert.equal(history[1]?.reportingManagerId, manager.id);
  });
});

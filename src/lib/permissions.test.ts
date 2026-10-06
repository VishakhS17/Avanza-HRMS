import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPrincipal,
  can,
  effectiveRoles,
  guardForPath,
  normalizeAssignedRoles,
} from "@/lib/permissions";

const employee = buildPrincipal({ id: "emp", assignedRoles: ["EMPLOYEE"] });
const manager = buildPrincipal({
  id: "mgr",
  assignedRoles: ["MANAGER"],
  directReportIds: ["emp"],
});
const hr = buildPrincipal({ id: "hr", assignedRoles: ["HR_ADMIN"] });
const admin = buildPrincipal({ id: "admin", assignedRoles: ["SUPER_ADMIN"] });

describe("effectiveRoles", () => {
  it("treats every user as an employee", () => {
    assert.deepEqual(effectiveRoles({ assignedRoles: [], directReportCount: 0 }), ["EMPLOYEE"]);
    assert.ok(effectiveRoles({ assignedRoles: ["SUPER_ADMIN"], directReportCount: 0 }).includes("EMPLOYEE"));
  });

  it("adds manager from explicit assignment or direct reports", () => {
    assert.ok(effectiveRoles({ assignedRoles: ["MANAGER"], directReportCount: 0 }).includes("MANAGER"));
    assert.ok(effectiveRoles({ assignedRoles: ["EMPLOYEE"], directReportCount: 2 }).includes("MANAGER"));
    assert.equal(
      effectiveRoles({ assignedRoles: ["EMPLOYEE"], directReportCount: 0 }).includes("MANAGER"),
      false,
    );
  });
});

describe("can", () => {
  it("lets every active employee open the shared app and nobody else open settings", () => {
    assert.equal(can(employee, "app.view"), true);
    assert.equal(can(employee, "settings.view"), false);
    assert.equal(can(employee, "audit.view"), false);
    assert.equal(can(employee, "users.manage"), false);
    assert.equal(can(manager, "settings.view"), false);
    assert.equal(can(manager, "audit.view"), false);
    assert.equal(can(null, "app.view"), false);
  });

  it("lets HR Admin open settings and the audit log, and only Super Admin manage users", () => {
    assert.equal(can(hr, "settings.view"), true);
    assert.equal(can(hr, "audit.view"), true);
    assert.equal(can(hr, "users.manage"), false);
    assert.equal(can(hr, "employee.sensitive.view"), true);
    assert.equal(can(admin, "employee.sensitive.view"), false);
    assert.equal(can(manager, "employee.sensitive.view"), false);
    assert.equal(can(employee, "employee.sensitive.view"), false);
    assert.equal(can(admin, "settings.view"), true);
    assert.equal(can(admin, "audit.view"), true);
    assert.equal(can(admin, "users.manage"), true);
  });

  it("scopes managers to their direct reports", () => {
    const report = { type: "employee" as const, id: "emp", managerId: "mgr" };
    const other = { type: "employee" as const, id: "other", managerId: "someone-else" };

    assert.equal(can(manager, "team.view"), true);
    assert.equal(can(employee, "team.view"), false);
    assert.equal(can(manager, "employee.view", report), true);
    assert.equal(can(manager, "employee.view", other), false);
    assert.equal(can(employee, "employee.view", { type: "employee", id: "emp", managerId: null }), true);
    assert.equal(can(employee, "employee.view", other), false);
    assert.equal(can(hr, "employee.view", other), true);
    assert.equal(can(admin, "reports.view", other), true);
    assert.equal(can(manager, "reports.view", other), false);
    assert.equal(can(manager, "reports.view", report), true);
  });

  it("rejects an inactive user even when the role would allow the action", () => {
    const inactive = buildPrincipal({
      id: "admin",
      status: "INACTIVE",
      assignedRoles: ["SUPER_ADMIN"],
    });
    assert.equal(can(inactive, "settings.view"), false);
    assert.equal(can(inactive, "audit.view"), false);
    assert.equal(can(inactive, "users.manage"), false);
  });
});

describe("route guards", () => {
  it("maps settings and the audit log to admin actions", () => {
    assert.equal(guardForPath("/settings"), "settings.view");
    assert.equal(guardForPath("/settings/users"), "users.manage");
    assert.equal(guardForPath("/settings/audit-log"), "audit.view");
    assert.equal(guardForPath("/settings/audit-log/export"), "audit.view");
    assert.equal(guardForPath("/"), null);
    assert.equal(can(employee, guardForPath("/settings") ?? "app.view"), false);
    assert.equal(can(employee, guardForPath("/settings/audit-log") ?? "app.view"), false);
    assert.equal(can(hr, guardForPath("/settings/users") ?? "app.view"), false);
  });
});

describe("normalizeAssignedRoles", () => {
  it("always keeps employee and rejects unknown roles", () => {
    assert.deepEqual(normalizeAssignedRoles(["HR_ADMIN"]), ["HR_ADMIN", "EMPLOYEE"]);
    assert.throws(() => normalizeAssignedRoles(["OWNER"]), /Unknown role/);
  });
});

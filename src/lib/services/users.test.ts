import "dotenv/config";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { AUDIT_ACTIONS } from "@/lib/services/audit";
import { allowedEmailDomain } from "@/lib/services/auth-policy";
import { setUserStatus, updateUserRoles, UserAdminError } from "@/lib/services/users";

describe("user administration audit", () => {
  const createdIds: string[] = [];

  after(async () => {
    if (createdIds.length > 0) {
      await getDb().user.deleteMany({ where: { id: { in: createdIds } } });
    }
    await getDb().$disconnect();
  });

  async function insertUser(roles: Array<"SUPER_ADMIN" | "HR_ADMIN" | "MANAGER" | "EMPLOYEE">) {
    const domain = allowedEmailDomain();
    const user = await getDb().user.create({
      data: {
        name: "RBAC test",
        email: `rbac-${crypto.randomUUID()}@${domain}`,
        status: "ACTIVE",
        roles,
      },
    });
    createdIds.push(user.id);
    return user;
  }

  it("writes a role change to the audit log", async () => {
    const actor = await insertUser(["SUPER_ADMIN", "EMPLOYEE"]);
    const target = await insertUser(["EMPLOYEE"]);

    await updateUserRoles({
      actorId: actor.id,
      userId: target.id,
      assignedRoles: ["HR_ADMIN"],
      reason: "Covers leave while HR is away",
    });

    const row = await getDb().auditLog.findFirst({
      where: {
        action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
        entityId: target.id,
        actorUserId: actor.id,
      },
      orderBy: { timestamp: "desc" },
    });
    assert.ok(row);
    assert.equal(row.reason, "Covers leave while HR is away");
    assert.deepEqual(row.before, { roles: ["EMPLOYEE"], status: "ACTIVE" });
    assert.deepEqual(row.after, { roles: ["HR_ADMIN", "EMPLOYEE"], status: "ACTIVE" });
  });

  it("writes deactivation and reactivation to the audit log", async () => {
    const actor = await insertUser(["SUPER_ADMIN", "EMPLOYEE"]);
    const target = await insertUser(["EMPLOYEE"]);

    await setUserStatus({
      actorId: actor.id,
      userId: target.id,
      status: "INACTIVE",
      reason: "Contract ended",
    });
    const deactivated = await getDb().auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.USER_DEACTIVATED, entityId: target.id },
    });
    assert.equal(deactivated?.reason, "Contract ended");

    await setUserStatus({
      actorId: actor.id,
      userId: target.id,
      status: "ACTIVE",
      reason: "Contract renewed",
    });
    const reactivated = await getDb().auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.USER_REACTIVATED, entityId: target.id },
    });
    assert.equal(reactivated?.reason, "Contract renewed");
  });

  it("blocks self role changes and non-admins", async () => {
    const actor = await insertUser(["SUPER_ADMIN", "EMPLOYEE"]);
    const hr = await insertUser(["HR_ADMIN", "EMPLOYEE"]);

    await assert.rejects(
      () =>
        updateUserRoles({
          actorId: actor.id,
          userId: actor.id,
          assignedRoles: ["EMPLOYEE"],
          reason: "Stepping down",
        }),
      UserAdminError,
    );
    await assert.rejects(
      () =>
        updateUserRoles({
          actorId: hr.id,
          userId: actor.id,
          assignedRoles: ["EMPLOYEE"],
          reason: "Not allowed",
        }),
      /cannot manage users/,
    );
  });
});

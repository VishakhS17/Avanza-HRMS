import "dotenv/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { trackTestData } from "@/test/fixtures";
import { AUDIT_ACTIONS, REDACTED, audit, redactSensitive } from "@/lib/services/audit";

describe("redactSensitive", () => {
  it("replaces passwords, bank details, id numbers, and tokens at any depth", () => {
    const input = {
      name: "Asha",
      email: "asha@avanza.example",
      password: "hunter2",
      passwordHash: "hash",
      bankAccountNumber: "99887766",
      bank: { ifsc: "HDFC0001", accountNumber: "1122" },
      profile: {
        city: "Pune",
        nationalId: "ABCDE1234F",
        pan: "ABCDE1234F",
      },
      sessions: [{ refreshToken: "tok_123", label: "laptop" }],
    };

    const output = redactSensitive(input);

    assert.equal(input.password, "hunter2");
    assert.equal(output.name, "Asha");
    assert.equal(output.email, "asha@avanza.example");
    assert.equal(output.password, REDACTED);
    assert.equal(output.passwordHash, REDACTED);
    assert.equal(output.bankAccountNumber, REDACTED);
    assert.equal(output.bank, REDACTED);
    assert.equal(output.profile.city, "Pune");
    assert.equal(output.profile.nationalId, REDACTED);
    assert.equal(output.profile.pan, REDACTED);
    assert.equal(output.sessions[0]?.refreshToken, REDACTED);
    assert.equal(output.sessions[0]?.label, "laptop");
  });
});

describe("audit.log", () => {
  trackTestData();

  it("writes a row with redacted before and after", async () => {
    const entityId = `audit-test-${crypto.randomUUID()}`;
    const row = await audit.log({
      actor: "user_acceptance",
      action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
      entityType: "AuditTest",
      entityId,
      reason: "Acceptance check",
      ipAddress: "127.0.0.1",
      userAgent: "audit-test",
      before: {
        name: "Asha",
        password: "hunter2",
        bankAccountNumber: "99887766",
        profile: { city: "Pune", nationalId: "ABCDE1234F" },
      },
      after: {
        name: "Asha Menon",
        password: "new-secret",
        profile: { city: "Pune", nationalId: "ABCDE1234F" },
        refreshToken: "tok_123",
      },
    });

    assert.equal(row.actorUserId, "user_acceptance");
    assert.equal(row.action, AUDIT_ACTIONS.EMPLOYEE_UPDATED);
    assert.equal(row.reason, "Acceptance check");
    assert.deepEqual(row.before, {
      name: "Asha",
      password: REDACTED,
      bankAccountNumber: REDACTED,
      profile: { city: "Pune", nationalId: REDACTED },
    });
    assert.deepEqual(row.after, {
      name: "Asha Menon",
      password: REDACTED,
      profile: { city: "Pune", nationalId: REDACTED },
      refreshToken: REDACTED,
    });

    const stored = await getDb().auditLog.findUniqueOrThrow({ where: { id: row.id } });
    assert.deepEqual(stored.before, row.before);
    assert.deepEqual(stored.after, row.after);
  });

  it("rolls back when the surrounding transaction rolls back", async () => {
    const entityId = `audit-rollback-${crypto.randomUUID()}`;

    await assert.rejects(
      () =>
        getDb().$transaction(async (tx) => {
          await audit.log(
            {
              actor: null,
              action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
              entityType: "AuditTest",
              entityId,
              before: null,
              after: { name: "Temporary" },
            },
            tx,
          );
          throw new Error("rollback");
        }),
      /rollback/,
    );

    const stored = await getDb().auditLog.findFirst({ where: { entityId } });
    assert.equal(stored, null);
  });

  it("rejects updates and deletes through the app and the database role", async () => {
    const entityId = `audit-lock-${crypto.randomUUID()}`;
    const row = await audit.log({
      actor: null,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "AuditTest",
      entityId,
      before: { ready: false },
      after: { ready: true },
    });

    await assert.rejects(
      () => getDb().auditLog.update({ where: { id: row.id }, data: { reason: "tampered" } }),
      /append-only/,
    );
    await assert.rejects(
      () => getDb().auditLog.delete({ where: { id: row.id } }),
      /append-only/,
    );

    const privileges = await getDb().$queryRaw<
      Array<{
        role: string;
        rolsuper: boolean;
        owner: string;
        member_of_owner: boolean;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
        can_truncate: boolean;
      }>
    >`
      SELECT
        current_user::text AS role,
        r.rolsuper,
        pg_get_userbyid(c.relowner)::text AS owner,
        pg_has_role(current_user, c.relowner, 'MEMBER') AS member_of_owner,
        has_table_privilege(current_user, 'audit_log', 'SELECT') AS can_select,
        has_table_privilege(current_user, 'audit_log', 'INSERT') AS can_insert,
        has_table_privilege(current_user, 'audit_log', 'UPDATE') AS can_update,
        has_table_privilege(current_user, 'audit_log', 'DELETE') AS can_delete,
        has_table_privilege(current_user, 'audit_log', 'TRUNCATE') AS can_truncate
      FROM pg_roles r, pg_class c
      WHERE r.rolname = current_user AND c.oid = 'audit_log'::regclass
    `;
    assert.equal(privileges[0]?.role, "avanza_hrms_app", "DATABASE_URL must connect as the app role");
    assert.equal(privileges[0]?.rolsuper, false);
    assert.notEqual(privileges[0]?.owner, privileges[0]?.role);
    assert.equal(privileges[0]?.member_of_owner, false);
    assert.equal(privileges[0]?.can_select, true);
    assert.equal(privileges[0]?.can_insert, true);
    assert.equal(privileges[0]?.can_update, false);
    assert.equal(privileges[0]?.can_delete, false);
    assert.equal(privileges[0]?.can_truncate, false);

    await assert.rejects(() =>
      getDb().$executeRaw`UPDATE audit_log SET reason = 'tampered' WHERE id = ${row.id}`,
    );
    await assert.rejects(() =>
      getDb().$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}`,
    );
    await assert.rejects(
      () =>
        getDb().$transaction(async (tx) => {
          await tx.$executeRaw`TRUNCATE audit_log`;
          throw new Error("TRUNCATE was allowed");
        }),
      /permission denied/,
    );

    const stored = await getDb().auditLog.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.reason, null);
    assert.equal(stored.entityId, entityId);
    assert.deepEqual(stored.after, { ready: true });
  });
});

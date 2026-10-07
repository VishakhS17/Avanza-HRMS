import { after, afterEach } from "node:test";
import pg from "pg";
import type { UserRole } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { allowedEmailDomain } from "@/lib/services/auth-policy";

function databaseName(url: string | undefined): string {
  if (!url) return "";
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** Database tests run only through `npm test`, which points DATABASE_URL at the test database. */
export function assertTestDatabaseEnv() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Database tests do not run with NODE_ENV=production.");
  }
  if (!databaseName(process.env.DATABASE_URL).endsWith("_test")) {
    throw new Error("DATABASE_URL is not a test database. Run the tests with npm test.");
  }
  if (!databaseName(process.env.TEST_DIRECT_URL).endsWith("_test")) {
    throw new Error("TEST_DIRECT_URL is not a test database. Run the tests with npm test.");
  }
}

assertTestDatabaseEnv();

/**
 * Rows created by one test. `trackTestData()` deletes them after each test, children first.
 * Audit rows stay: the app role cannot delete them, and the runner ignores them.
 */
export class TestData {
  readonly userIds: string[] = [];
  readonly departmentIds: string[] = [];
  readonly designationIds: string[] = [];
  readonly locationIds: string[] = [];

  async user(roles: UserRole[], label = "Test user") {
    const user = await getDb().user.create({
      data: {
        name: label,
        email: `test-${crypto.randomUUID()}@${allowedEmailDomain()}`,
        status: "ACTIVE",
        roles,
      },
    });
    this.userIds.push(user.id);
    return user;
  }

  async cleanup() {
    const users = this.userIds.splice(0);
    const departments = this.departmentIds.splice(0);
    const designations = this.designationIds.splice(0);
    const locations = this.locationIds.splice(0);
    const db = getDb();

    if (users.length > 0) {
      await deleteProtectedRows(users);
      await db.attendanceRecord.deleteMany({ where: { employeeId: { in: users } } });
      await db.attendanceRegularization.deleteMany({ where: { employeeId: { in: users } } });
      await db.leaveLedger.deleteMany({ where: { employeeId: { in: users }, reversesId: { not: null } } });
      await db.leaveLedger.deleteMany({ where: { employeeId: { in: users } } });
      await db.leaveRequestDay.deleteMany({ where: { employeeId: { in: users } } });
      await db.leaveRequest.deleteMany({ where: { employeeId: { in: users } } });
      await db.approvalRequest.deleteMany({
        where: { OR: [{ requesterId: { in: users } }, { approverId: { in: users } }] },
      });
      await db.notification.deleteMany({ where: { userId: { in: users } } });
      await db.employment.deleteMany({
        where: { OR: [{ employeeId: { in: users } }, { reportingManagerId: { in: users } }] },
      });
      await db.employee.deleteMany({ where: { id: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    }
    if (locations.length > 0) {
      await db.holiday.deleteMany({ where: { locationId: { in: locations } } });
      await db.shift.deleteMany({ where: { locationId: { in: locations } } });
      await db.location.deleteMany({ where: { id: { in: locations } } });
    }
    if (departments.length > 0) await db.department.deleteMany({ where: { id: { in: departments } } });
    if (designations.length > 0) await db.designation.deleteMany({ where: { id: { in: designations } } });
  }
}

/** Rows the app role may not delete. Removed through the test owner connection only. */
async function deleteProtectedRows(employeeIds: string[]) {
  const client = new pg.Client({ connectionString: process.env.TEST_DIRECT_URL });
  await client.connect();
  try {
    const db = await client.query("SELECT current_database() AS name");
    if (!String(db.rows[0]?.name).endsWith("_test")) {
      throw new Error("TEST_DIRECT_URL is not a test database.");
    }
    const table = await client.query("SELECT to_regclass('public.attendance_events') AS t");
    if (!table.rows[0]?.t) return;
    await client.query("BEGIN");
    await client.query('ALTER TABLE "attendance_events" DISABLE TRIGGER USER');
    await client.query('DELETE FROM "attendance_events" WHERE "employeeId" = ANY($1)', [employeeIds]);
    await client.query('ALTER TABLE "attendance_events" ENABLE TRIGGER USER');
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/** Call inside a `describe`. Cleans up after every test in it and disconnects at the end. */
export function trackTestData(): TestData {
  const data = new TestData();
  afterEach(() => data.cleanup());
  after(() => getDb().$disconnect());
  return data;
}

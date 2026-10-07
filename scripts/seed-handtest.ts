/**
 * Dev-only sample data for hand-testing, created through the normal services so every
 * row has its usual audit entry. Acts as the bootstrap admin from `npm run db:seed`.
 * Running it again creates nothing new and changes nothing that already exists.
 */
import "dotenv/config";
import { assertHandtestDatabase } from "./handtest-guard.mjs";
import { getDb } from "@/lib/db";
import { addDaysIso, todayIso } from "@/lib/leave-dates";
import { allowedEmailDomain, normalizeEmail } from "@/lib/services/auth-policy";
import { createEmployee } from "@/lib/services/employees";
import { createDepartment, createDesignation, createLocation } from "@/lib/services/organization";

assertHandtestDatabase();

const META = { ipAddress: null, userAgent: "npm run seed:handtest" };
const DEPARTMENT = "Hand-test Operations";
const DESIGNATION = "Hand-test Associate";
const LOCATION = { name: "Hand-test Depot", city: "Testville" };

type Person = { code: string; name: string; local: string; reportsTo: string | null };

// The bootstrap admin has no employee record, so nobody can report to them. Employee B
// has no manager, which routes B's leave and regularization approvals to the admin.
const PEOPLE: Person[] = [
  { code: "HT-MGR", name: "Handtest Manager", local: "handtest.manager", reportsTo: null },
  { code: "HT-A", name: "Handtest Employee A", local: "handtest.employee.a", reportsTo: "HT-MGR" },
  { code: "HT-B", name: "Handtest Employee B", local: "handtest.employee.b", reportsTo: null },
];

async function bootstrapAdmin() {
  const email = normalizeEmail(process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL);
  const admin = email ? await getDb().user.findUnique({ where: { email } }) : null;
  if (!admin || admin.status !== "ACTIVE" || !admin.roles.includes("SUPER_ADMIN")) {
    throw new Error("The bootstrap admin is missing or not an active Super Admin. Run npm run db:seed first.");
  }
  return admin;
}

async function ensureDepartment(actorId: string) {
  const existing = await getDb().department.findUnique({ where: { name: DEPARTMENT } });
  if (existing) return { row: existing, created: false };
  return { row: await createDepartment({ actorId, name: DEPARTMENT, meta: META }), created: true };
}

async function ensureDesignation(actorId: string) {
  const existing = await getDb().designation.findUnique({ where: { name: DESIGNATION } });
  if (existing) return { row: existing, created: false };
  return { row: await createDesignation({ actorId, name: DESIGNATION, meta: META }), created: true };
}

async function ensureLocation(actorId: string) {
  const existing = await getDb().location.findUnique({ where: { name: LOCATION.name } });
  if (existing) return { row: existing, created: false };
  return { row: await createLocation({ actorId, ...LOCATION, meta: META }), created: true };
}

async function main() {
  const admin = await bootstrapAdmin();
  const domain = allowedEmailDomain();
  const joiningDate = addDaysIso(todayIso(), -30);

  const department = await ensureDepartment(admin.id);
  const designation = await ensureDesignation(admin.id);
  const location = await ensureLocation(admin.id);
  for (const [label, item] of [
    ["Department", department],
    ["Designation", designation],
    ["Location", location],
  ] as const) {
    console.log(`${label} "${item.row.name}": ${item.created ? "created" : "already exists"}.`);
  }
  const shift = await getDb().shift.findUnique({ where: { locationId: location.row.id } });
  console.log(`Shift at "${location.row.name}": ${shift ? `${shift.name} ${shift.startTime}-${shift.endTime}` : "MISSING"}.`);

  const ids = new Map<string, string>();
  for (const person of PEOPLE) {
    const email = `${person.local}@${domain}`;
    const managerId = person.reportsTo ? ids.get(person.reportsTo) : null;
    if (managerId === undefined) throw new Error(`${person.reportsTo} must be created before ${person.code}.`);
    const existing = await getDb().employee.findUnique({ where: { workEmail: email } });
    if (existing) {
      ids.set(person.code, existing.id);
      console.log(`Employee ${person.code} ${email}: already exists.`);
      continue;
    }
    const orphanUser = await getDb().user.findUnique({ where: { email } });
    if (orphanUser) {
      throw new Error(`A user ${email} exists without an employee record. Fix it in Settings before re-running.`);
    }
    const created = await createEmployee({
      actorId: admin.id,
      employeeCode: person.code,
      name: person.name,
      workEmail: email,
      joiningDate,
      status: "ACTIVE",
      designationId: designation.row.id,
      departmentId: department.row.id,
      locationId: location.row.id,
      reportingManagerId: managerId,
      employmentType: "FULL_TIME",
      meta: META,
    });
    ids.set(person.code, created.id);
    console.log(`Employee ${person.code} ${email}: created, joining ${joiningDate}.`);
  }

  const rows = await getDb().employee.findMany({
    where: { id: { in: [...ids.values()] } },
    include: {
      user: { select: { status: true, roles: true } },
      employments: { where: { endDate: null }, include: { reportingManager: { select: { workEmail: true } } } },
    },
    orderBy: { employeeCode: "asc" },
  });
  console.log("\nSample users (sign in with the dev password form):");
  for (const row of rows) {
    const manager = row.employments[0]?.reportingManager?.workEmail ?? "none (approvals go to the admin)";
    console.log(
      `  ${row.employeeCode.padEnd(7)} ${row.workEmail.padEnd(40)} user ${row.user.status}, joined ${row.joiningDate
        .toISOString()
        .slice(0, 10)}, reports to ${manager}`,
    );
  }
  await getDb().$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await getDb().$disconnect();
  process.exit(1);
});

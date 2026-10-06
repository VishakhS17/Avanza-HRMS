import { getDb } from "@/lib/db";

const CATALOG = [
  {
    code: "CASUAL",
    name: "Casual",
    isPaid: true,
    sortOrder: 1,
    accrualMode: "MONTHLY" as const,
    accrualDays: "1.00",
    carryForwardCap: "0.00",
    halfDayAllowed: true,
    excludeWeekends: true,
    excludeHolidays: true,
    probationEligible: false,
    probationMonths: 6,
    balanceEnforced: true,
  },
  {
    code: "SICK",
    name: "Sick",
    isPaid: true,
    sortOrder: 2,
    accrualMode: "ANNUAL" as const,
    accrualDays: "6.00",
    carryForwardCap: "0.00",
    halfDayAllowed: true,
    excludeWeekends: true,
    excludeHolidays: true,
    probationEligible: true,
    probationMonths: 6,
    balanceEnforced: true,
  },
  {
    code: "EARNED",
    name: "Earned",
    isPaid: true,
    sortOrder: 3,
    accrualMode: "MONTHLY" as const,
    accrualDays: "1.50",
    carryForwardCap: "12.00",
    halfDayAllowed: false,
    excludeWeekends: true,
    excludeHolidays: true,
    probationEligible: false,
    probationMonths: 6,
    balanceEnforced: true,
  },
  {
    code: "LOP",
    name: "Unpaid (LOP)",
    isPaid: false,
    sortOrder: 4,
    accrualMode: "MANUAL" as const,
    accrualDays: "0.00",
    carryForwardCap: "0.00",
    halfDayAllowed: true,
    excludeWeekends: true,
    excludeHolidays: true,
    probationEligible: true,
    probationMonths: 6,
    balanceEnforced: false,
  },
];

/** Inserts the four leave types when they are missing. Existing rows are left as they are. */
export async function ensureLeaveCatalog(): Promise<string> {
  const db = getDb();
  for (const item of CATALOG) {
    const type = await db.leaveType.upsert({
      where: { code: item.code },
      update: {},
      create: {
        code: item.code,
        name: item.name,
        isPaid: item.isPaid,
        sortOrder: item.sortOrder,
      },
    });
    await db.leavePolicy.upsert({
      where: { leaveTypeId: type.id },
      update: {},
      create: {
        leaveTypeId: type.id,
        accrualMode: item.accrualMode,
        accrualDays: item.accrualDays,
        carryForwardCap: item.carryForwardCap,
        halfDayAllowed: item.halfDayAllowed,
        excludeWeekends: item.excludeWeekends,
        excludeHolidays: item.excludeHolidays,
        probationEligible: item.probationEligible,
        probationMonths: item.probationMonths,
        balanceEnforced: item.balanceEnforced,
      },
    });
  }
  return "Leave types are ready.";
}

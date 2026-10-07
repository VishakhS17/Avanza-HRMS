import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { WEEKDAYS, formatIsoDate, isWeekdayName, parseIsoDate, todayIso, type WeekdayName } from "@/lib/leave-dates";
import { can } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { recomputeAttendance } from "@/lib/services/attendance";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { LeaveError } from "@/lib/services/leave-errors";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type HolidayView = {
  id: string;
  date: string;
  name: string;
  isActive: boolean;
};

export type HolidayLocation = {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
  weeklyOff: WeekdayName[];
};

async function requireSettings(actorId: string) {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "settings.view")) {
    throw new EmployeeAccessError("forbidden", "You cannot manage holidays.");
  }
  return actor;
}

function holidayName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw new LeaveError("Holiday name must be 1 to 80 characters.");
  }
  return name;
}

function weeklyOffDays(values: readonly string[]): WeekdayName[] {
  const days: WeekdayName[] = [];
  for (const value of values) {
    if (!isWeekdayName(value)) throw new LeaveError("Choose a weekday.");
    if (!days.includes(value)) days.push(value);
  }
  return WEEKDAYS.filter((day) => days.includes(day));
}

export async function listMyHolidays(actorId: string): Promise<{
  locationName: string | null;
  weeklyOff: WeekdayName[];
  holidays: HolidayView[];
}> {
  await requireActiveActor(actorId);
  const job = await getDb().employment.findFirst({
    where: { employeeId: actorId, endDate: null },
    include: { location: true },
  });
  if (!job) return { locationName: null, weeklyOff: [], holidays: [] };
  const year = todayIso().slice(0, 4);
  const rows = await getDb().holiday.findMany({
    where: {
      locationId: job.locationId,
      isActive: true,
      date: { gte: parseIsoDate(`${year}-01-01`), lte: parseIsoDate(`${year}-12-31`) },
    },
    orderBy: { date: "asc" },
  });
  return {
    locationName: job.location.name,
    weeklyOff: job.location.weeklyOff,
    holidays: rows.map((row) => ({
      id: row.id,
      date: formatIsoDate(row.date),
      name: row.name,
      isActive: row.isActive,
    })),
  };
}

export async function listHolidayAdmin(actorId: string, locationId?: string) {
  await requireSettings(actorId);
  const locations = await getDb().location.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, isActive: true, weeklyOff: true },
  });
  const selected = locations.find((location) => location.id === locationId) ?? locations.find((location) => location.isActive) ?? locations[0] ?? null;
  const holidays = selected
    ? await getDb().holiday.findMany({
        where: { locationId: selected.id },
        orderBy: { date: "asc" },
      })
    : [];
  return {
    locations,
    selected,
    holidays: holidays.map((row) => ({
      id: row.id,
      date: formatIsoDate(row.date),
      name: row.name,
      isActive: row.isActive,
    })),
  };
}

export async function setWeeklyOff(input: {
  actorId: string;
  locationId: string;
  weeklyOff: readonly string[];
  meta?: AuditMeta;
}) {
  const actor = await requireSettings(input.actorId);
  const days = weeklyOffDays(input.weeklyOff);
  const existing = await getDb().location.findUnique({ where: { id: input.locationId } });
  if (!existing) throw new LeaveError("That location was not found.");
  await getDb().$transaction(async (tx) => {
    await tx.location.update({ where: { id: existing.id }, data: { weeklyOff: days } });
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.SETTINGS_UPDATED,
        entityType: "Location",
        entityId: existing.id,
        before: { weeklyOff: existing.weeklyOff },
        after: { weeklyOff: days },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
  });
}

export async function createHoliday(input: {
  actorId: string;
  locationId: string;
  date: string;
  name: string;
  meta?: AuditMeta;
}) {
  const actor = await requireSettings(input.actorId);
  const name = holidayName(input.name);
  const date = parseIsoDate(input.date);
  const location = await getDb().location.findUnique({ where: { id: input.locationId } });
  if (!location) throw new LeaveError("That location was not found.");
  try {
    await getDb().$transaction(async (tx) => {
      const row = await tx.holiday.create({
        data: { locationId: location.id, date, name },
      });
      await recomputeAttendance(tx, {
        dates: [input.date],
        locationId: location.id,
        actorId: actor.id,
        reason: `Holiday added: ${name}`,
        meta: input.meta,
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.HOLIDAY_CREATED,
          entityType: "Holiday",
          entityId: row.id,
          before: null,
          after: { locationId: location.id, date: input.date, name, isActive: true },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new LeaveError("That date already has a holiday. Edit the existing one.");
    }
    throw error;
  }
}

export async function updateHoliday(input: {
  actorId: string;
  id: string;
  name: string;
  isActive: boolean;
  meta?: AuditMeta;
}) {
  const actor = await requireSettings(input.actorId);
  const name = holidayName(input.name);
  const existing = await getDb().holiday.findUnique({ where: { id: input.id } });
  if (!existing) throw new LeaveError("That holiday was not found.");
  await getDb().$transaction(async (tx) => {
    await tx.holiday.update({
      where: { id: existing.id },
      data: { name, isActive: input.isActive },
    });
    if (existing.isActive !== input.isActive) {
      await recomputeAttendance(tx, {
        dates: [formatIsoDate(existing.date)],
        locationId: existing.locationId,
        actorId: actor.id,
        reason: `Holiday ${input.isActive ? "restored" : "removed"}: ${name}`,
        meta: input.meta,
      });
    }
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.HOLIDAY_UPDATED,
        entityType: "Holiday",
        entityId: existing.id,
        before: { name: existing.name, isActive: existing.isActive },
        after: { name, isActive: input.isActive },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
  });
}

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { EmployeeAccessError, OrganizationError } from "@/lib/services/employee-errors";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type OrgRow = {
  id: string;
  name: string;
  isActive: boolean;
  city?: string | null;
};

function requiredName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw new OrganizationError("Name must be 1 to 80 characters.");
  }
  return name;
}

function optionalCity(value: string | null | undefined): string | null {
  const city = value?.trim() ?? "";
  if (!city) return null;
  if (city.length > 80) {
    throw new OrganizationError("City must be 80 characters or fewer.");
  }
  return city;
}

async function requireSettings(actorId: string) {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "settings.view")) {
    throw new EmployeeAccessError("forbidden", "You cannot manage organization settings.");
  }
  return actor;
}

function rethrowKnown(error: unknown, label: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new OrganizationError(`A ${label} with that name already exists.`);
  }
  throw error;
}

export async function listDepartments(
  actorId: string,
  options?: { activeOnly?: boolean },
): Promise<OrgRow[]> {
  await requireSettings(actorId);
  const rows = await getDb().department.findMany({
    where: options?.activeOnly ? { isActive: true } : undefined,
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive }));
}

export async function createDepartment(input: { actorId: string; name: string; meta?: AuditMeta }) {
  const actor = await requireSettings(input.actorId);
  const name = requiredName(input.name);
  try {
    return await getDb().$transaction(async (tx) => {
      const row = await tx.department.create({ data: { name } });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.SETTINGS_UPDATED,
          entityType: "Department",
          entityId: row.id,
          before: null,
          after: { name: row.name, isActive: row.isActive },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    rethrowKnown(error, "department");
  }
}

export async function updateDepartment(input: {
  actorId: string;
  id: string;
  name: string;
  isActive: boolean;
  meta?: AuditMeta;
}) {
  const actor = await requireSettings(input.actorId);
  const name = requiredName(input.name);
  const existing = await getDb().department.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new OrganizationError("Department not found.");
  }
  if (existing.name === name && existing.isActive === input.isActive) {
    return existing;
  }
  try {
    return await getDb().$transaction(async (tx) => {
      const row = await tx.department.update({
        where: { id: existing.id },
        data: { name, isActive: input.isActive },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.SETTINGS_UPDATED,
          entityType: "Department",
          entityId: row.id,
          before: { name: existing.name, isActive: existing.isActive },
          after: { name: row.name, isActive: row.isActive },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    rethrowKnown(error, "department");
  }
}

export async function listDesignations(
  actorId: string,
  options?: { activeOnly?: boolean },
): Promise<OrgRow[]> {
  await requireSettings(actorId);
  const rows = await getDb().designation.findMany({
    where: options?.activeOnly ? { isActive: true } : undefined,
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive }));
}

export async function createDesignation(input: { actorId: string; name: string; meta?: AuditMeta }) {
  const actor = await requireSettings(input.actorId);
  const name = requiredName(input.name);
  try {
    return await getDb().$transaction(async (tx) => {
      const row = await tx.designation.create({ data: { name } });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.SETTINGS_UPDATED,
          entityType: "Designation",
          entityId: row.id,
          before: null,
          after: { name: row.name, isActive: row.isActive },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    rethrowKnown(error, "designation");
  }
}

export async function updateDesignation(input: {
  actorId: string;
  id: string;
  name: string;
  isActive: boolean;
  meta?: AuditMeta;
}) {
  const actor = await requireSettings(input.actorId);
  const name = requiredName(input.name);
  const existing = await getDb().designation.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new OrganizationError("Designation not found.");
  }
  if (existing.name === name && existing.isActive === input.isActive) {
    return existing;
  }
  try {
    return await getDb().$transaction(async (tx) => {
      const row = await tx.designation.update({
        where: { id: existing.id },
        data: { name, isActive: input.isActive },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.SETTINGS_UPDATED,
          entityType: "Designation",
          entityId: row.id,
          before: { name: existing.name, isActive: existing.isActive },
          after: { name: row.name, isActive: row.isActive },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    rethrowKnown(error, "designation");
  }
}

export async function listLocations(
  actorId: string,
  options?: { activeOnly?: boolean },
): Promise<OrgRow[]> {
  await requireSettings(actorId);
  const rows = await getDb().location.findMany({
    where: options?.activeOnly ? { isActive: true } : undefined,
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, city: row.city, isActive: row.isActive }));
}

export async function createLocation(input: {
  actorId: string;
  name: string;
  city?: string | null;
  meta?: AuditMeta;
}) {
  const actor = await requireSettings(input.actorId);
  const name = requiredName(input.name);
  const city = optionalCity(input.city);
  try {
    return await getDb().$transaction(async (tx) => {
      const row = await tx.location.create({ data: { name, city } });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.SETTINGS_UPDATED,
          entityType: "Location",
          entityId: row.id,
          before: null,
          after: { name: row.name, city: row.city, isActive: row.isActive },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    rethrowKnown(error, "location");
  }
}

export async function updateLocation(input: {
  actorId: string;
  id: string;
  name: string;
  city?: string | null;
  isActive: boolean;
  meta?: AuditMeta;
}) {
  const actor = await requireSettings(input.actorId);
  const name = requiredName(input.name);
  const city = optionalCity(input.city);
  const existing = await getDb().location.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new OrganizationError("Location not found.");
  }
  if (existing.name === name && existing.city === city && existing.isActive === input.isActive) {
    return existing;
  }
  try {
    return await getDb().$transaction(async (tx) => {
      const row = await tx.location.update({
        where: { id: existing.id },
        data: { name, city, isActive: input.isActive },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.SETTINGS_UPDATED,
          entityType: "Location",
          entityId: row.id,
          before: { name: existing.name, city: existing.city, isActive: existing.isActive },
          after: { name: row.name, city: row.city, isActive: row.isActive },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return row;
    });
  } catch (error) {
    rethrowKnown(error, "location");
  }
}

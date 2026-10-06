import {
  EmployeeStatus,
  EmploymentType,
  Gender,
  Prisma,
  type EmployeeStatus as EmployeeStatusValue,
  type EmploymentType as EmploymentTypeValue,
  type Gender as GenderValue,
} from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { can, type Principal } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { allowedEmailDomain, isCompanyEmail, normalizeEmail } from "@/lib/services/auth-policy";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { decryptField, encryptField } from "@/lib/services/employee-crypto";
import { EmployeeAccessError, EmployeeError } from "@/lib/services/employee-errors";
import { SENSITIVE_FIELDS, type SensitiveField } from "@/lib/employee-labels";
import { assertReportingLine } from "@/lib/services/reporting";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type { SensitiveField };
export { SENSITIVE_FIELDS };

const employmentInclude = {
  designation: true,
  department: true,
  location: true,
  reportingManager: true,
} satisfies Prisma.EmploymentInclude;

const employeeInclude = {
  employments: {
    include: employmentInclude,
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.EmployeeInclude;

type EmploymentRow = Prisma.EmploymentGetPayload<{ include: typeof employmentInclude }>;
type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

export type EmployeeJob = {
  designation: { id: string; name: string };
  department: { id: string; name: string };
  location: { id: string; name: string; city: string | null };
  employmentType: EmploymentTypeValue;
  reportingManager: { id: string; name: string } | null;
  startDate: string;
};

export type EmployeeHistoryRow = {
  id: string;
  designation: string;
  department: string;
  location: string;
  employmentType: EmploymentTypeValue;
  reportingManager: string | null;
  startDate: string;
  endDate: string | null;
};

export type EmployeePersonal = {
  dateOfBirth: string | null;
  gender: GenderValue | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  emergencyName: string | null;
  emergencyRelation: string | null;
  emergencyPhone: string | null;
  sensitive: Record<SensitiveField, string | null>;
};

export type EmployeeRecord = {
  id: string;
  employeeCode: string;
  name: string;
  workEmail: string;
  phone: string | null;
  status: EmployeeStatusValue;
  joiningDate: string;
  job: EmployeeJob | null;
  personal: EmployeePersonal | null;
  history: EmployeeHistoryRow[] | null;
};

export type EmployeeListRow = {
  id: string;
  employeeCode: string;
  name: string;
  workEmail: string;
  department: string;
  location: string;
  status: EmployeeStatusValue;
};

export type DirectoryRow = {
  id: string;
  name: string;
  designation: string;
  department: string;
  location: string;
  manager: string;
  workEmail: string;
  phone: string | null;
};

export type EmployeeListFilters = {
  query?: string;
  departmentId?: string;
  locationId?: string;
  status?: string;
};

type ContactInput = {
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyName?: string | null;
  emergencyRelation?: string | null;
  emergencyPhone?: string | null;
};

type SensitiveInput = Partial<Record<SensitiveField, string | null>> & {
  clear?: readonly string[];
};

function forbidden(message: string): EmployeeAccessError {
  return new EmployeeAccessError("forbidden", message);
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string, label: string): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new EmployeeError(`Enter a valid ${label}.`);
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    throw new EmployeeError(`Enter a valid ${label}.`);
  }
  return date;
}

function dayBefore(date: Date): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() - 1);
  return next;
}

function requiredText(value: string | null | undefined, label: string, max: number): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new EmployeeError(`${label} must be 1 to ${max} characters.`);
  }
  return trimmed;
}

function optionalText(value: string | null | undefined, label: string, max: number): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new EmployeeError(`${label} must be ${max} characters or fewer.`);
  }
  return trimmed;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function requiredCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(code)) {
    throw new EmployeeError("Employee code must be 1 to 32 letters, numbers, or hyphens.");
  }
  return code;
}

function requiredWorkEmail(value: string): string {
  const email = normalizeEmail(value);
  if (!isCompanyEmail(email, allowedEmailDomain())) {
    throw new EmployeeError("Work email must belong to the company domain.");
  }
  return email;
}

function parseStatus(value: string): EmployeeStatusValue {
  if (!(Object.values(EmployeeStatus) as string[]).includes(value)) {
    throw new EmployeeError("Unknown status.");
  }
  return value as EmployeeStatusValue;
}

function parseEmploymentType(value: string): EmploymentTypeValue {
  if (!(Object.values(EmploymentType) as string[]).includes(value)) {
    throw new EmployeeError("Unknown employment type.");
  }
  return value as EmploymentTypeValue;
}

function parseGender(value: string | null | undefined): GenderValue | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (!(Object.values(Gender) as string[]).includes(trimmed)) {
    throw new EmployeeError("Unknown gender.");
  }
  return trimmed as GenderValue;
}

function optionalDate(value: string | null | undefined, label: string): Date | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return parseIsoDate(trimmed, label);
}

function isSensitiveField(value: string): value is SensitiveField {
  return (SENSITIVE_FIELDS as readonly string[]).includes(value);
}

function last4(value: string): string {
  return value.replace(/\s+/g, "").slice(-4);
}

function masked(cipher: string | null, hint: string | null): string | null {
  if (!cipher) return null;
  return hint ? `••••${hint}` : "••••";
}

function sealOrThrow(plain: string): string {
  try {
    return encryptField(plain);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EMPLOYEE_DATA_KEY")) {
      throw new EmployeeError("Sensitive fields are not configured. Set EMPLOYEE_DATA_KEY.");
    }
    throw error;
  }
}

function openOrThrow(payload: string): string {
  try {
    return decryptField(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EMPLOYEE_DATA_KEY")) {
      throw new EmployeeError("Sensitive fields are not configured. Set EMPLOYEE_DATA_KEY.");
    }
    throw new EmployeeError("That value could not be read.");
  }
}

function rethrowKnown(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = JSON.stringify(error.meta?.target ?? "");
    if (target.toLowerCase().includes("code")) {
      throw new EmployeeError("That employee code is already in use.");
    }
    throw new EmployeeError("That work email is already in use.");
  }
  throw error;
}

function contactFrom(input: ContactInput) {
  return {
    phone: optionalText(input.phone, "Phone", 40),
    addressLine1: optionalText(input.addressLine1, "Address", 120),
    addressLine2: optionalText(input.addressLine2, "Address line 2", 120),
    city: optionalText(input.city, "City", 80),
    state: optionalText(input.state, "State", 80),
    postalCode: optionalText(input.postalCode, "Postal code", 16),
    country: optionalText(input.country, "Country", 80),
    emergencyName: optionalText(input.emergencyName, "Emergency contact name", 120),
    emergencyRelation: optionalText(input.emergencyRelation, "Emergency contact relation", 80),
    emergencyPhone: optionalText(input.emergencyPhone, "Emergency contact phone", 40),
  };
}

function profileAudit(row: {
  employeeCode: string;
  name: string;
  workEmail: string;
  phone: string | null;
  dateOfBirth: Date | null;
  gender: GenderValue | null;
  joiningDate: Date;
  status: EmployeeStatusValue;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  emergencyName: string | null;
  emergencyRelation: string | null;
  emergencyPhone: string | null;
  bankAccountName: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  pan: string | null;
  governmentId: string | null;
}) {
  const sensitiveOnFile = SENSITIVE_FIELDS.filter((field) => Boolean(row[field]));
  return {
    employeeCode: row.employeeCode,
    name: row.name,
    workEmail: row.workEmail,
    phone: row.phone,
    dateOfBirth: row.dateOfBirth ? formatIsoDate(row.dateOfBirth) : null,
    gender: row.gender,
    joiningDate: formatIsoDate(row.joiningDate),
    status: row.status,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    emergencyName: row.emergencyName,
    emergencyRelation: row.emergencyRelation,
    emergencyPhone: row.emergencyPhone,
    sensitiveOnFile,
  };
}

function jobAudit(row: {
  designationId: string;
  departmentId: string;
  locationId: string;
  reportingManagerId: string | null;
  employmentType: EmploymentTypeValue;
  startDate: Date;
  endDate: Date | null;
}) {
  return {
    designationId: row.designationId,
    departmentId: row.departmentId,
    locationId: row.locationId,
    reportingManagerId: row.reportingManagerId,
    employmentType: row.employmentType,
    startDate: formatIsoDate(row.startDate),
    endDate: row.endDate ? formatIsoDate(row.endDate) : null,
  };
}

function toJob(row: EmploymentRow): EmployeeJob {
  return {
    designation: { id: row.designation.id, name: row.designation.name },
    department: { id: row.department.id, name: row.department.name },
    location: { id: row.location.id, name: row.location.name, city: row.location.city },
    employmentType: row.employmentType,
    reportingManager: row.reportingManager
      ? { id: row.reportingManager.id, name: row.reportingManager.name }
      : null,
    startDate: formatIsoDate(row.startDate),
  };
}

function toHistory(row: EmploymentRow): EmployeeHistoryRow {
  return {
    id: row.id,
    designation: row.designation.name,
    department: row.department.name,
    location: row.location.name,
    employmentType: row.employmentType,
    reportingManager: row.reportingManager?.name ?? null,
    startDate: formatIsoDate(row.startDate),
    endDate: row.endDate ? formatIsoDate(row.endDate) : null,
  };
}

function toPersonal(row: EmployeeRow): EmployeePersonal {
  return {
    dateOfBirth: row.dateOfBirth ? formatIsoDate(row.dateOfBirth) : null,
    gender: row.gender,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    emergencyName: row.emergencyName,
    emergencyRelation: row.emergencyRelation,
    emergencyPhone: row.emergencyPhone,
    sensitive: {
      bankAccountName: masked(row.bankAccountName, null),
      bankName: masked(row.bankName, null),
      bankAccountNumber: masked(row.bankAccountNumber, row.bankAccountLast4),
      bankIfsc: masked(row.bankIfsc, null),
      pan: masked(row.pan, row.panLast4),
      governmentId: masked(row.governmentId, row.governmentIdLast4),
    },
  };
}

function toRecord(row: EmployeeRow, options: { personal: boolean; history: boolean }): EmployeeRecord {
  const current = row.employments.find((job) => job.endDate === null) ?? null;
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    name: row.name,
    workEmail: row.workEmail,
    phone: row.phone,
    status: row.status,
    joiningDate: formatIsoDate(row.joiningDate),
    job: current ? toJob(current) : null,
    personal: options.personal ? toPersonal(row) : null,
    history: options.history ? row.employments.map(toHistory) : null,
  };
}

async function loadEmployee(id: string): Promise<EmployeeRow | null> {
  return getDb().employee.findUnique({ where: { id }, include: employeeInclude });
}

function canSeePersonal(actor: Principal, employeeId: string): boolean {
  return actor.id === employeeId || can(actor, "people.view");
}

export async function getEmployeeForActor(
  actor: Principal,
  employeeId: string,
): Promise<EmployeeRecord> {
  const row = await loadEmployee(employeeId);
  if (!row) {
    if (actor.id === employeeId || can(actor, "people.view")) {
      throw new EmployeeAccessError("not-found", "Employee not found.");
    }
    throw forbidden("You cannot view this employee.");
  }
  const current = row.employments.find((job) => job.endDate === null) ?? null;
  const allowed = can(actor, "employee.view", {
    type: "employee",
    id: row.id,
    managerId: current?.reportingManagerId ?? null,
  });
  if (!allowed) {
    throw forbidden("You cannot view this employee.");
  }
  const personal = canSeePersonal(actor, row.id);
  return toRecord(row, { personal, history: personal });
}

export async function readEmployeeApi(
  actor: Principal | null,
  employeeId: string,
): Promise<Response> {
  if (!actor || actor.status !== "ACTIVE") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const record = await getEmployeeForActor(actor, employeeId);
    return Response.json(record, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EmployeeAccessError) {
      const status = error.kind === "not-found" ? 404 : 403;
      return Response.json({ error: status === 404 ? "Not found" : "Forbidden" }, { status });
    }
    throw error;
  }
}

async function requirePeople(actorId: string): Promise<Principal> {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "people.view")) {
    throw forbidden("You cannot manage employee records.");
  }
  return actor;
}

async function requireActiveDepartment(db: Prisma.TransactionClient, id: string) {
  const row = await db.department.findUnique({ where: { id } });
  if (!row?.isActive) throw new EmployeeError("Choose an active department.");
  return row;
}

async function requireActiveDesignation(db: Prisma.TransactionClient, id: string) {
  const row = await db.designation.findUnique({ where: { id } });
  if (!row?.isActive) throw new EmployeeError("Choose an active designation.");
  return row;
}

async function requireActiveLocation(db: Prisma.TransactionClient, id: string) {
  const row = await db.location.findUnique({ where: { id } });
  if (!row?.isActive) throw new EmployeeError("Choose an active location.");
  return row;
}

function normalizePan(value: string): string {
  const pan = value.trim().toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    throw new EmployeeError("PAN must look like ABCDE1234F.");
  }
  return pan;
}

function cleanSensitiveValue(field: SensitiveField, value: string): string {
  if (field === "pan") return normalizePan(value);
  const limit = field === "bankAccountNumber" || field === "governmentId" ? 40 : 80;
  return requiredText(value, "That sensitive field", limit);
}

type SensitiveWrite = {
  bankAccountName?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountLast4?: string | null;
  bankIfsc?: string | null;
  pan?: string | null;
  panLast4?: string | null;
  governmentId?: string | null;
  governmentIdLast4?: string | null;
};

function sensitiveColumns(input: Partial<Record<SensitiveField, string>>): SensitiveWrite {
  const columns: SensitiveWrite = {};
  for (const field of SENSITIVE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    const cipher = sealOrThrow(value);
    if (field === "bankAccountName") columns.bankAccountName = cipher;
    if (field === "bankName") columns.bankName = cipher;
    if (field === "bankAccountNumber") {
      columns.bankAccountNumber = cipher;
      columns.bankAccountLast4 = last4(value);
    }
    if (field === "bankIfsc") columns.bankIfsc = cipher;
    if (field === "pan") {
      columns.pan = cipher;
      columns.panLast4 = last4(value);
    }
    if (field === "governmentId") {
      columns.governmentId = cipher;
      columns.governmentIdLast4 = last4(value);
    }
  }
  return columns;
}

function assertCanWriteSensitive(actor: Principal, input: SensitiveInput | undefined) {
  if (!input) return;
  const writes = SENSITIVE_FIELDS.some((field) => Boolean(input[field]?.trim()));
  const clears = (input.clear ?? []).length > 0;
  if ((writes || clears) && !can(actor, "employee.sensitive.view")) {
    throw forbidden("Only HR Admin can change sensitive fields.");
  }
}

function collectSensitive(input: SensitiveInput | undefined): {
  values: Partial<Record<SensitiveField, string>>;
  clear: SensitiveField[];
} {
  const values: Partial<Record<SensitiveField, string>> = {};
  const clear: SensitiveField[] = [];
  if (!input) return { values, clear };
  for (const field of input.clear ?? []) {
    if (!isSensitiveField(field)) throw new EmployeeError("Unknown sensitive field.");
    clear.push(field);
  }
  for (const field of SENSITIVE_FIELDS) {
    if (clear.includes(field)) continue;
    const raw = input[field];
    if (raw == null || !raw.trim()) continue;
    values[field] = cleanSensitiveValue(field, raw);
  }
  return { values, clear };
}

function applySensitiveWrite(
  values: Partial<Record<SensitiveField, string>>,
  clear: readonly SensitiveField[],
): SensitiveWrite {
  const columns = sensitiveColumns(values);
  for (const field of clear) {
    if (field === "bankAccountName") columns.bankAccountName = null;
    if (field === "bankName") columns.bankName = null;
    if (field === "bankAccountNumber") {
      columns.bankAccountNumber = null;
      columns.bankAccountLast4 = null;
    }
    if (field === "bankIfsc") columns.bankIfsc = null;
    if (field === "pan") {
      columns.pan = null;
      columns.panLast4 = null;
    }
    if (field === "governmentId") {
      columns.governmentId = null;
      columns.governmentIdLast4 = null;
    }
  }
  return columns;
}

export async function createEmployee(input: {
  actorId: string;
  employeeCode: string;
  name: string;
  workEmail: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  joiningDate: string;
  status: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyName?: string | null;
  emergencyRelation?: string | null;
  emergencyPhone?: string | null;
  designationId: string;
  departmentId: string;
  locationId: string;
  reportingManagerId?: string | null;
  employmentType: string;
  sensitive?: SensitiveInput;
  meta?: AuditMeta;
}) {
  const actor = await requirePeople(input.actorId);
  assertCanWriteSensitive(actor, input.sensitive);
  const employeeCode = requiredCode(input.employeeCode);
  const name = requiredText(input.name, "Name", 120);
  const workEmail = requiredWorkEmail(input.workEmail);
  const joiningDate = parseIsoDate(input.joiningDate, "joining date");
  const dateOfBirth = optionalDate(input.dateOfBirth, "date of birth");
  if (dateOfBirth && dateOfBirth.getTime() >= Date.now()) {
    throw new EmployeeError("Date of birth must be in the past.");
  }
  const status = parseStatus(input.status);
  const gender = parseGender(input.gender);
  const contact = contactFrom(input);
  const employmentType = parseEmploymentType(input.employmentType);
  const managerId = blankToNull(input.reportingManagerId);
  const sensitive = collectSensitive(input.sensitive);
  const userStatus = status === "EXITED" ? "INACTIVE" : "ACTIVE";

  try {
    return await getDb().$transaction(async (tx) => {
      await requireActiveDepartment(tx, input.departmentId.trim());
      await requireActiveDesignation(tx, input.designationId.trim());
      await requireActiveLocation(tx, input.locationId.trim());

      const user = await tx.user.create({
        data: {
          name,
          email: workEmail,
          status: userStatus,
          roles: ["EMPLOYEE"],
          statusReason: userStatus === "INACTIVE" ? "Employee exited" : null,
          statusChangedAt: userStatus === "INACTIVE" ? new Date() : null,
        },
      });
      if (managerId) {
        await assertReportingLine(tx, user.id, managerId);
      }
      const sensitiveData = applySensitiveWrite(sensitive.values, sensitive.clear);
      const employee = await tx.employee.create({
        data: {
          id: user.id,
          employeeCode,
          name,
          workEmail,
          dateOfBirth,
          gender,
          joiningDate,
          status,
          ...contact,
          ...sensitiveData,
        },
      });
      const employment = await tx.employment.create({
        data: {
          employeeId: employee.id,
          designationId: input.designationId.trim(),
          departmentId: input.departmentId.trim(),
          locationId: input.locationId.trim(),
          reportingManagerId: managerId,
          employmentType,
          startDate: joiningDate,
          openKey: employee.id,
        },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.USER_CREATED,
          entityType: "User",
          entityId: user.id,
          before: null,
          after: { name, email: workEmail, status: userStatus, roles: ["EMPLOYEE"] },
          reason: "Employee record created",
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.EMPLOYEE_CREATED,
          entityType: "Employee",
          entityId: employee.id,
          before: null,
          after: { ...profileAudit(employee), ...jobAudit(employment) },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return { id: employee.id };
    });
  } catch (error) {
    rethrowKnown(error);
  }
}

export async function updateEmployeeProfile(input: {
  actorId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  workEmail: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  joiningDate: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyName?: string | null;
  emergencyRelation?: string | null;
  emergencyPhone?: string | null;
  meta?: AuditMeta;
}) {
  const actor = await requirePeople(input.actorId);
  const employeeCode = requiredCode(input.employeeCode);
  const name = requiredText(input.name, "Name", 120);
  const workEmail = requiredWorkEmail(input.workEmail);
  const joiningDate = parseIsoDate(input.joiningDate, "joining date");
  const dateOfBirth = optionalDate(input.dateOfBirth, "date of birth");
  if (dateOfBirth && dateOfBirth.getTime() >= Date.now()) {
    throw new EmployeeError("Date of birth must be in the past.");
  }
  const gender = parseGender(input.gender);
  const contact = contactFrom(input);
  const existing = await getDb().employee.findUnique({ where: { id: input.employeeId } });
  if (!existing) throw new EmployeeError("Employee not found.");

  const next = { employeeCode, name, workEmail, dateOfBirth, gender, joiningDate, ...contact };
  const unchanged =
    existing.employeeCode === next.employeeCode &&
    existing.name === next.name &&
    existing.workEmail === next.workEmail &&
    existing.phone === next.phone &&
    (existing.dateOfBirth?.getTime() ?? null) === (next.dateOfBirth?.getTime() ?? null) &&
    existing.gender === next.gender &&
    existing.joiningDate.getTime() === next.joiningDate.getTime() &&
    existing.addressLine1 === next.addressLine1 &&
    existing.addressLine2 === next.addressLine2 &&
    existing.city === next.city &&
    existing.state === next.state &&
    existing.postalCode === next.postalCode &&
    existing.country === next.country &&
    existing.emergencyName === next.emergencyName &&
    existing.emergencyRelation === next.emergencyRelation &&
    existing.emergencyPhone === next.emergencyPhone;
  if (unchanged) return existing;

  try {
    return await getDb().$transaction(async (tx) => {
      const employee = await tx.employee.update({ where: { id: existing.id }, data: next });
      await tx.user.update({
        where: { id: existing.id },
        data: { name, email: workEmail },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
          entityType: "Employee",
          entityId: employee.id,
          before: profileAudit(existing),
          after: profileAudit(employee),
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return employee;
    });
  } catch (error) {
    rethrowKnown(error);
  }
}

export async function updateOwnContact(input: {
  actorId: string;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyName?: string | null;
  emergencyRelation?: string | null;
  emergencyPhone?: string | null;
  meta?: AuditMeta;
}) {
  const actor = await requireActiveActor(input.actorId);
  const existing = await getDb().employee.findUnique({ where: { id: actor.id } });
  if (!existing) throw new EmployeeError("You do not have an employee record yet.");
  const allowed = can(actor, "employee.view", {
    type: "employee",
    id: actor.id,
    managerId: null,
  });
  if (!allowed) throw forbidden("You cannot edit this profile.");

  const contact = contactFrom(input);
  const unchanged = (Object.keys(contact) as (keyof typeof contact)[]).every(
    (key) => existing[key] === contact[key],
  );
  if (unchanged) return existing;

  return getDb().$transaction(async (tx) => {
    const employee = await tx.employee.update({ where: { id: existing.id }, data: contact });
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
        entityType: "Employee",
        entityId: employee.id,
        before: profileAudit(existing),
        after: profileAudit(employee),
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    return employee;
  });
}

export async function updateSensitiveFields(input: {
  actorId: string;
  employeeId: string;
  sensitive: SensitiveInput;
  meta?: AuditMeta;
}) {
  const actor = await requirePeople(input.actorId);
  if (!can(actor, "employee.sensitive.view")) {
    throw forbidden("Only HR Admin can change sensitive fields.");
  }
  const existing = await getDb().employee.findUnique({ where: { id: input.employeeId } });
  if (!existing) throw new EmployeeError("Employee not found.");
  const { values, clear } = collectSensitive(input.sensitive);
  if (Object.keys(values).length === 0 && clear.length === 0) {
    throw new EmployeeError("Enter a value to save, or choose a field to clear.");
  }
  const data = applySensitiveWrite(values, clear);
  return getDb().$transaction(async (tx) => {
    const employee = await tx.employee.update({ where: { id: existing.id }, data });
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
        entityType: "Employee",
        entityId: employee.id,
        before: { sensitiveOnFile: profileAudit(existing).sensitiveOnFile },
        after: { sensitiveOnFile: profileAudit(employee).sensitiveOnFile },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    return employee;
  });
}

async function assertNotLastSuperAdmin(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.roles.includes("SUPER_ADMIN")) return;
  const others = await tx.user.count({
    where: { id: { not: userId }, status: "ACTIVE", roles: { has: "SUPER_ADMIN" } },
  });
  if (others === 0) {
    throw new EmployeeError("The last active Super Admin cannot be exited.");
  }
}

export async function changeEmployeeStatus(input: {
  actorId: string;
  employeeId: string;
  status: string;
  meta?: AuditMeta;
}) {
  const actor = await requirePeople(input.actorId);
  const status = parseStatus(input.status);
  const existing = await getDb().employee.findUnique({
    where: { id: input.employeeId },
    include: { user: true },
  });
  if (!existing) throw new EmployeeError("Employee not found.");
  if (existing.status === status) {
    throw new EmployeeError("Status is already set to that.");
  }

  return getDb().$transaction(async (tx) => {
    if (status === "EXITED") {
      await assertNotLastSuperAdmin(tx, existing.id);
    }
    const employee = await tx.employee.update({
      where: { id: existing.id },
      data: { status },
    });
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.EMPLOYEE_STATUS_CHANGED,
        entityType: "Employee",
        entityId: employee.id,
        before: { status: existing.status },
        after: { status: employee.status },
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );

    if (status === "EXITED" && existing.user.status === "ACTIVE") {
      await tx.user.update({
        where: { id: existing.id },
        data: {
          status: "INACTIVE",
          statusReason: "Employee exited",
          statusChangedAt: new Date(),
        },
      });
      await tx.session.deleteMany({ where: { userId: existing.id } });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.USER_DEACTIVATED,
          entityType: "User",
          entityId: existing.id,
          before: { status: "ACTIVE", roles: existing.user.roles },
          after: { status: "INACTIVE", roles: existing.user.roles },
          reason: "Employee exited",
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
    }

    if (existing.status === "EXITED" && status !== "EXITED" && existing.user.status === "INACTIVE") {
      await tx.user.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          statusReason: "Employee returned from exited",
          statusChangedAt: new Date(),
        },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.USER_REACTIVATED,
          entityType: "User",
          entityId: existing.id,
          before: { status: "INACTIVE", roles: existing.user.roles },
          after: { status: "ACTIVE", roles: existing.user.roles },
          reason: "Employee returned from exited",
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
    }

    return employee;
  });
}

export async function changeEmployment(input: {
  actorId: string;
  employeeId: string;
  designationId: string;
  departmentId: string;
  locationId: string;
  reportingManagerId?: string | null;
  employmentType: string;
  startDate: string;
  meta?: AuditMeta;
}) {
  const actor = await requirePeople(input.actorId);
  const employmentType = parseEmploymentType(input.employmentType);
  const startDate = parseIsoDate(input.startDate, "effective date");
  const managerId = blankToNull(input.reportingManagerId);
  const designationId = input.designationId.trim();
  const departmentId = input.departmentId.trim();
  const locationId = input.locationId.trim();

  try {
    return await getDb().$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: input.employeeId } });
      if (!employee) throw new EmployeeError("Employee not found.");
      const current = await tx.employment.findFirst({
        where: { employeeId: employee.id, endDate: null },
      });
      if (!current) throw new EmployeeError("This employee has no current job.");

      const same =
        current.designationId === designationId &&
        current.departmentId === departmentId &&
        current.locationId === locationId &&
        (current.reportingManagerId ?? null) === managerId &&
        current.employmentType === employmentType;
      if (same) {
        throw new EmployeeError(
          "No job fields changed. A new history row is only created when the job changes.",
        );
      }
      if (startDate.getTime() <= current.startDate.getTime()) {
        throw new EmployeeError("The effective date must be after the current job's start date.");
      }

      await requireActiveDesignation(tx, designationId);
      await requireActiveDepartment(tx, departmentId);
      await requireActiveLocation(tx, locationId);
      await assertReportingLine(tx, employee.id, managerId);

      const closed = await tx.employment.update({
        where: { id: current.id },
        data: { endDate: dayBefore(startDate), openKey: null },
      });
      const created = await tx.employment.create({
        data: {
          employeeId: employee.id,
          designationId,
          departmentId,
          locationId,
          reportingManagerId: managerId,
          employmentType,
          startDate,
          openKey: employee.id,
        },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
          entityType: "Employment",
          entityId: created.id,
          before: jobAudit(closed),
          after: jobAudit(created),
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return created;
    });
  } catch (error) {
    rethrowKnown(error);
  }
}

function cipherFor(row: EmployeeRow, field: SensitiveField): string | null {
  switch (field) {
    case "bankAccountName":
      return row.bankAccountName;
    case "bankName":
      return row.bankName;
    case "bankAccountNumber":
      return row.bankAccountNumber;
    case "bankIfsc":
      return row.bankIfsc;
    case "pan":
      return row.pan;
    case "governmentId":
      return row.governmentId;
  }
}

export async function revealSensitiveField(input: {
  actorId: string;
  employeeId: string;
  field: string;
  meta?: AuditMeta;
}): Promise<string> {
  const actor = await requireActiveActor(input.actorId);
  if (!can(actor, "employee.sensitive.view")) {
    throw forbidden("Only HR Admin can reveal sensitive fields.");
  }
  if (!isSensitiveField(input.field)) {
    throw new EmployeeError("Unknown sensitive field.");
  }
  const row = await loadEmployee(input.employeeId);
  if (!row) throw new EmployeeError("Employee not found.");
  const cipher = cipherFor(row, input.field);
  if (!cipher) throw new EmployeeError("That field is empty.");
  const plain = openOrThrow(cipher);
  await audit.log({
    actor: actor.id,
    action: AUDIT_ACTIONS.SENSITIVE_FIELD_REVEALED,
    entityType: "Employee",
    entityId: row.id,
    before: null,
    after: { field: input.field },
    ipAddress: input.meta?.ipAddress,
    userAgent: input.meta?.userAgent,
  });
  return plain;
}

export async function listEmployees(
  actorId: string,
  filters: EmployeeListFilters,
): Promise<EmployeeListRow[]> {
  await requirePeople(actorId);
  const query = filters.query?.trim() ?? "";
  const status = filters.status?.trim() ?? "";
  const departmentId = filters.departmentId?.trim() ?? "";
  const locationId = filters.locationId?.trim() ?? "";
  const rows = await getDb().employee.findMany({
    where: {
      ...(status && (Object.values(EmployeeStatus) as string[]).includes(status)
        ? { status: status as EmployeeStatusValue }
        : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { workEmail: { contains: query, mode: "insensitive" } },
              { employeeCode: { contains: query, mode: "insensitive" } },
              { phone: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
      employments: {
        some: {
          endDate: null,
          ...(departmentId ? { departmentId } : {}),
          ...(locationId ? { locationId } : {}),
        },
      },
    },
    include: {
      employments: {
        where: { endDate: null },
        include: { department: true, location: true },
      },
    },
    orderBy: [{ name: "asc" }, { employeeCode: "asc" }],
  });
  return rows.map((row) => {
    const job = row.employments[0];
    return {
      id: row.id,
      employeeCode: row.employeeCode,
      name: row.name,
      workEmail: row.workEmail,
      department: job?.department.name ?? "—",
      location: job?.location.name ?? "—",
      status: row.status,
    };
  });
}

export async function listDirectory(actorId: string, query: string): Promise<DirectoryRow[]> {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "app.view")) throw forbidden("You cannot view the directory.");
  const q = query.trim();
  const rows = await getDb().employee.findMany({
    where: {
      status: { in: ["ACTIVE", "NOTICE"] },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { workEmail: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              {
                employments: {
                  some: {
                    endDate: null,
                    OR: [
                      { department: { name: { contains: q, mode: "insensitive" } } },
                      { designation: { name: { contains: q, mode: "insensitive" } } },
                      { location: { name: { contains: q, mode: "insensitive" } } },
                      { reportingManager: { name: { contains: q, mode: "insensitive" } } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      employments: { where: { endDate: null }, include: employmentInclude },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => {
    const job = row.employments[0];
    return {
      id: row.id,
      name: row.name,
      designation: job?.designation.name ?? "—",
      department: job?.department.name ?? "—",
      location: job?.location.name ?? "—",
      manager: job?.reportingManager?.name ?? "—",
      workEmail: row.workEmail,
      phone: row.phone,
    };
  });
}

export async function listTeam(actorId: string): Promise<EmployeeRecord[]> {
  const actor = await requireActiveActor(actorId);
  if (!can(actor, "team.view")) throw forbidden("You cannot view this team.");
  if (actor.directReportIds.length === 0) return [];
  const rows = await getDb().employee.findMany({
    where: { id: { in: [...actor.directReportIds] } },
    include: employeeInclude,
    orderBy: { name: "asc" },
  });
  return rows.map((row) => toRecord(row, { personal: false, history: false }));
}

export async function listManagerChoices(actorId: string, excludeId?: string) {
  await requirePeople(actorId);
  return getDb().employee.findMany({
    where: {
      status: { in: ["ACTIVE", "NOTICE"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      employments: { some: { endDate: null } },
    },
    select: { id: true, name: true, employeeCode: true },
    orderBy: { name: "asc" },
  });
}

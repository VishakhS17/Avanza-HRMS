import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

/**
 * Standard audit action names. Add a constant here when a feature records a change.
 * Callers should use these values so the settings viewer can filter on them.
 */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN: "AUTH_LOGIN",
  AUTH_LOGOUT: "AUTH_LOGOUT",
  AUTH_LOGIN_FAILED: "AUTH_LOGIN_FAILED",
  USER_CREATED: "USER_CREATED",
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  USER_DEACTIVATED: "USER_DEACTIVATED",
  USER_REACTIVATED: "USER_REACTIVATED",
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
  EMPLOYEE_UPDATED: "EMPLOYEE_UPDATED",
  EMPLOYEE_STATUS_CHANGED: "EMPLOYEE_STATUS_CHANGED",
  LEAVE_REQUESTED: "LEAVE_REQUESTED",
  LEAVE_APPROVED: "LEAVE_APPROVED",
  LEAVE_REJECTED: "LEAVE_REJECTED",
  LEAVE_CANCELLED: "LEAVE_CANCELLED",
  LEAVE_BALANCE_ADJUSTED: "LEAVE_BALANCE_ADJUSTED",
  LEAVE_ACCRUED: "LEAVE_ACCRUED",
  LEAVE_CARRY_FORWARD: "LEAVE_CARRY_FORWARD",
  LEAVE_REVERSED: "LEAVE_REVERSED",
  ATTENDANCE_RECORDED: "ATTENDANCE_RECORDED",
  ATTENDANCE_OVERRIDDEN: "ATTENDANCE_OVERRIDDEN",
  ATTENDANCE_CHECKED_IN: "ATTENDANCE_CHECKED_IN",
  ATTENDANCE_CHECKED_OUT: "ATTENDANCE_CHECKED_OUT",
  ATTENDANCE_REGULARIZATION_REQUESTED: "ATTENDANCE_REGULARIZATION_REQUESTED",
  ATTENDANCE_REGULARIZATION_APPROVED: "ATTENDANCE_REGULARIZATION_APPROVED",
  ATTENDANCE_REGULARIZATION_REJECTED: "ATTENDANCE_REGULARIZATION_REJECTED",
  SHIFT_CREATED: "SHIFT_CREATED",
  SHIFT_UPDATED: "SHIFT_UPDATED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_VERSION_ADDED: "DOCUMENT_VERSION_ADDED",
  DOCUMENT_UPDATED: "DOCUMENT_UPDATED",
  DOCUMENT_ASSIGNED: "DOCUMENT_ASSIGNED",
  DOCUMENT_REMOVED: "DOCUMENT_REMOVED",
  DOCUMENT_ACKNOWLEDGED: "DOCUMENT_ACKNOWLEDGED",
  DOCUMENT_VIEWED: "DOCUMENT_VIEWED",
  HOLIDAY_CREATED: "HOLIDAY_CREATED",
  HOLIDAY_UPDATED: "HOLIDAY_UPDATED",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  SENSITIVE_FIELD_REVEALED: "SENSITIVE_FIELD_REVEALED",
  REPORT_EXPORTED: "REPORT_EXPORTED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_EXPORT_LIMIT = 5000;
/** Calendar-day filters and the viewer clock. Avanza works in India. */
export const AUDIT_TIME_ZONE = "Asia/Kolkata";
const AUDIT_TIME_ZONE_OFFSET = "+05:30";

export const REDACTED = "[REDACTED]";

const SENSITIVE_PARTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "authorization",
  "bankaccount",
  "accountnumber",
  "iban",
  "ifsc",
  "routingnumber",
  "ssn",
  "aadhaar",
  "aadhar",
  "passport",
  "nationalid",
  "governmentid",
  "taxid",
  "pannumber",
  "pancard",
  "idnumber",
  "creditcard",
  "cardnumber",
  "cvv",
];

export type AuditDb = PrismaClient | Prisma.TransactionClient;

export type AuditLogInput = {
  /** User id, or null for a system job. */
  actor: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditLogSearch = {
  from?: string;
  to?: string;
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "pan" || normalized === "bank") {
    return true;
  }
  if (normalized.startsWith("bank") || normalized.endsWith("bank")) {
    return true;
  }
  return SENSITIVE_PARTS.some((part) => normalized.includes(part));
}

/** Returns a copy. Sensitive keys are replaced at any depth. The input is left as-is. */
export function redactSensitive<T>(value: T): T {
  return redact(value) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(child);
  }
  return output;
}

function toAuditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) {
    return Prisma.DbNull;
  }

  let plain: unknown;
  try {
    plain = JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error("Audit before/after must be JSON-serializable.");
  }

  return redactSensitive(plain) as Prisma.InputJsonValue;
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Audit ${label} is required.`);
  }
  return trimmed;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, max);
}

/**
 * Insert one audit row. Pass the transaction client as the second argument
 * so the row commits or rolls back with the change it describes.
 * There is no update or delete helper. The table rejects both.
 */
async function log(input: AuditLogInput, db: AuditDb = getDb()) {
  const actor = optionalText(input.actor, 200);

  return db.auditLog.create({
    data: {
      actorUserId: actor,
      action: input.action,
      entityType: requiredText(input.entityType, "entityType"),
      entityId: requiredText(input.entityId, "entityId"),
      before: toAuditJson(input.before),
      after: toAuditJson(input.after),
      reason: optionalText(input.reason, 2000),
      ipAddress: optionalText(input.ipAddress, 64),
      userAgent: optionalText(input.userAgent, 512),
    },
  });
}

export const audit = { log };

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim().slice(0, 200) ?? "";
}

function parseDay(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  const start = new Date(`${value}T00:00:00${AUDIT_TIME_ZONE_OFFSET}`);
  if (Number.isNaN(start.getTime())) {
    return undefined;
  }
  return value;
}

export function parseAuditLogSearch(params: SearchParams): AuditLogSearch {
  const pageRaw = Number.parseInt(firstParam(params.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const from = parseDay(firstParam(params.from));
  const to = parseDay(firstParam(params.to));
  const actor = firstParam(params.actor);
  const action = firstParam(params.action);
  const entityType = firstParam(params.entityType);
  const entityId = firstParam(params.entityId);

  return {
    page,
    from,
    to,
    actor: actor || undefined,
    action: action || undefined,
    entityType: entityType || undefined,
    entityId: entityId || undefined,
  };
}

function dayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00${AUDIT_TIME_ZONE_OFFSET}`);
}

function dayEnd(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999${AUDIT_TIME_ZONE_OFFSET}`);
}

function whereFor(search: AuditLogSearch): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (search.actor) {
    where.actorUserId = { contains: search.actor, mode: "insensitive" };
  }
  if (search.action) {
    where.action = search.action;
  }
  if (search.entityType) {
    where.entityType = { equals: search.entityType, mode: "insensitive" };
  }
  if (search.entityId) {
    where.entityId = { contains: search.entityId, mode: "insensitive" };
  }
  if (search.from || search.to) {
    where.timestamp = {
      ...(search.from ? { gte: dayStart(search.from) } : {}),
      ...(search.to ? { lte: dayEnd(search.to) } : {}),
    };
  }

  return where;
}

export async function listAuditLogs(
  search: AuditLogSearch,
  options?: { pageSize?: number },
) {
  const pageSize = options?.pageSize ?? AUDIT_PAGE_SIZE;
  const page = search.page;
  const where = whereFor(search);
  const db = getDb();

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { rows, total, page, pageSize };
}

function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }
  return guarded;
}

export function toAuditCsv(
  rows: Array<{
    timestamp: Date;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    reason: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
  }>,
): string {
  const header = [
    "timestamp",
    "actorUserId",
    "action",
    "entityType",
    "entityId",
    "reason",
    "ipAddress",
    "userAgent",
    "before",
    "after",
  ];
  const lines = [header.join(",")];

  for (const row of rows) {
    const cells = [
      row.timestamp.toISOString(),
      row.actorUserId ?? "",
      row.action,
      row.entityType,
      row.entityId,
      row.reason ?? "",
      row.ipAddress ?? "",
      row.userAgent ?? "",
      row.before == null ? "" : JSON.stringify(row.before),
      row.after == null ? "" : JSON.stringify(row.after),
    ];
    lines.push(cells.map(csvCell).join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

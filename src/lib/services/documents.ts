import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type DocumentStatus,
  type DocumentUploader,
  type DocumentVisibility,
  type EmployeeStatus,
} from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { can, type Principal } from "@/lib/permissions";
import { requireActiveActor } from "@/lib/services/actor";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { DocumentAccessError, DocumentError } from "@/lib/services/document-errors";
import { getStorage, SIGNED_URL_TTL_SECONDS } from "@/lib/storage";
import { FileValidationError, validateUpload, type UploadInput } from "@/lib/storage/files";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type Tx = Prisma.TransactionClient;

export const POLICIES = "POLICIES";
/** Categories one document can be assigned to many employees in. The rest are personal. */
export const SHARED_CATEGORIES: ReadonlySet<string> = new Set([POLICIES, "OTHER_HR"]);
const ASSIGNABLE_STATUSES: EmployeeStatus[] = ["PRE_JOINING", "ACTIVE", "NOTICE"];
const VISIBILITIES: readonly DocumentVisibility[] = ["EMPLOYEE_ONLY", "HR_ONLY", "EMPLOYEE_AND_HR"];
const VERSION_RETRIES = 5;

// ---------------------------------------------------------------------------
// Access rules. Every read and write below goes through these.
// ---------------------------------------------------------------------------

export type DocumentAccessFacts = {
  categoryCode: string;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  assigneeIds: readonly string[];
};

export function includesEmployee(visibility: DocumentVisibility): boolean {
  return visibility !== "HR_ONLY";
}

export function includesHr(visibility: DocumentVisibility): boolean {
  return visibility !== "EMPLOYEE_ONLY";
}

export function effectiveVisibility(
  document: { visibility: DocumentVisibility | null },
  category: { defaultVisibility: DocumentVisibility },
): DocumentVisibility {
  return document.visibility ?? category.defaultVisibility;
}

/**
 * HR Admin acts as HR on other people's documents. On their own record they are an
 * employee like anyone else, so a second HR Admin has to act. Policies are the exception.
 */
export function hasHrRights(actor: Principal, facts: Pick<DocumentAccessFacts, "categoryCode" | "assigneeIds">): boolean {
  if (!can(actor, "documents.manage")) return false;
  return facts.categoryCode === POLICIES || !facts.assigneeIds.includes(actor.id);
}

/** Managers and Super Admins get no rule here, so they only reach documents assigned to themselves. */
export function canOpenDocument(actor: Principal, facts: DocumentAccessFacts): boolean {
  if (hasHrRights(actor, facts) && includesHr(facts.visibility)) return true;
  return facts.status === "ACTIVE" && facts.assigneeIds.includes(actor.id) && includesEmployee(facts.visibility);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const accessInclude = {
  category: true,
  assignments: { select: { employeeId: true } },
} satisfies Prisma.DocumentInclude;

type AccessRow = Prisma.DocumentGetPayload<{ include: typeof accessInclude }>;

function factsOf(row: AccessRow): DocumentAccessFacts {
  return {
    categoryCode: row.category.code,
    visibility: effectiveVisibility(row, row.category),
    status: row.status,
    assigneeIds: row.assignments.map((assignment) => assignment.employeeId),
  };
}

async function loadForAccess(db: Tx | ReturnType<typeof getDb>, documentId: string): Promise<AccessRow> {
  const row = await db.document.findUnique({ where: { id: documentId }, include: accessInclude });
  if (!row) throw new DocumentAccessError();
  return row;
}

async function activeActor(actorId: string): Promise<Principal> {
  try {
    return await requireActiveActor(actorId);
  } catch {
    throw new DocumentAccessError();
  }
}

async function requireHr(actorId: string): Promise<Principal> {
  const actor = await activeActor(actorId);
  if (!can(actor, "documents.manage")) throw new DocumentAccessError();
  return actor;
}

function requiredText(value: string | null | undefined, label: string, min: number, max: number): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length < min || trimmed.length > max) {
    throw new DocumentError(`${label} must be ${min} to ${max} characters.`);
  }
  return trimmed;
}

function optionalText(value: string | null | undefined, label: string, max: number): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > max) throw new DocumentError(`${label} must be ${max} characters or fewer.`);
  return trimmed;
}

function parseVisibility(value: string | null | undefined): DocumentVisibility | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (!(VISIBILITIES as readonly string[]).includes(trimmed)) throw new DocumentError("Choose who can see this document.");
  return trimmed as DocumentVisibility;
}

function parseExpiry(value: string | null | undefined): Date | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    throw new DocumentError("Enter a valid expiry date.");
  }
  return date;
}

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function validFile(file: UploadInput) {
  try {
    return validateUpload(file);
  } catch (error) {
    if (error instanceof FileValidationError) throw new DocumentError(error.message);
    throw error;
  }
}

async function requireCategory(code: string) {
  const category = await getDb().documentCategory.findUnique({ where: { code: code.trim() } });
  if (!category) throw new DocumentError("Choose a category.");
  return category;
}

function assertAckAllowed(input: {
  requiresAcknowledgement: boolean;
  uploader: DocumentUploader;
  visibility: DocumentVisibility;
}) {
  if (!input.requiresAcknowledgement) return;
  if (input.uploader === "EMPLOYEE") {
    throw new DocumentError("Only documents HR shares can ask for an acknowledgement.");
  }
  if (!includesEmployee(input.visibility)) {
    throw new DocumentError("An HR-only document cannot ask the employee for an acknowledgement.");
  }
}

function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta ?? {}).includes("versionNumber")
  );
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type StoredFile = {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

/** Writes the object first. The caller removes it if the database transaction fails. */
async function storeFile(file: UploadInput): Promise<StoredFile> {
  const valid = validFile(file);
  const storageKey = `documents/${randomUUID()}`;
  await getStorage().put(storageKey, valid.bytes, valid.contentType);
  return {
    storageKey,
    fileName: valid.fileName,
    contentType: valid.contentType,
    sizeBytes: valid.bytes.byteLength,
    sha256: createHash("sha256").update(valid.bytes).digest("hex"),
  };
}

async function withStoredFile<T>(file: UploadInput, write: (stored: StoredFile) => Promise<T>): Promise<T> {
  const stored = await storeFile(file);
  try {
    return await write(stored);
  } catch (error) {
    await getStorage().remove(stored.storageKey).catch(() => {});
    throw error;
  }
}

function versionAudit(stored: StoredFile, versionNumber: number) {
  return { versionNumber, fileName: stored.fileName, contentType: stored.contentType, sizeBytes: stored.sizeBytes, sha256: stored.sha256 };
}

async function notifyUsers(tx: Tx, userIds: readonly string[], input: { title: string; body: string; href: string }) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await tx.notification.createMany({
    data: unique.map((userId) => ({ userId, title: input.title, body: input.body, href: input.href })),
  });
}

async function notifyHrAdmins(tx: Tx, exceptUserId: string, input: { title: string; body: string; href: string }) {
  const admins = await tx.user.findMany({
    where: { status: "ACTIVE", roles: { has: "HR_ADMIN" }, id: { not: exceptUserId } },
    select: { id: true },
  });
  await notifyUsers(tx, admins.map((admin) => admin.id), input);
}

async function requireAssignableEmployees(tx: Tx, employeeIds: readonly string[]) {
  const rows = await tx.employee.findMany({
    where: { id: { in: [...employeeIds] }, status: { in: ASSIGNABLE_STATUSES } },
    select: { id: true, name: true },
  });
  if (rows.length !== employeeIds.length) {
    throw new DocumentError("Choose employees who are pre-joining, active, or on notice.");
  }
  return rows;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/** An employee uploads their own Identity, Address, Education, or Certificates file. */
export async function uploadOwnDocument(input: {
  actorId: string;
  categoryCode: string;
  title: string;
  description?: string | null;
  file: UploadInput;
  meta?: AuditMeta;
}) {
  const actor = await activeActor(input.actorId);
  const category = await requireCategory(input.categoryCode);
  if (category.uploader !== "EMPLOYEE") {
    throw new DocumentError("HR uploads documents in this category.");
  }
  const employee = await getDb().employee.findUnique({ where: { id: actor.id }, select: { status: true, name: true } });
  if (!employee || employee.status === "EXITED") {
    throw new DocumentError("You do not have an employee record yet.");
  }
  const title = requiredText(input.title, "Title", 1, 120);
  const description = optionalText(input.description, "Description", 500);

  return withStoredFile(input.file, (stored) =>
    getDb().$transaction(async (tx) => {
      const document = await tx.document.create({
        data: { categoryId: category.id, title, description, createdById: actor.id },
      });
      await tx.documentAssignment.create({
        data: { documentId: document.id, employeeId: actor.id, assignedById: actor.id },
      });
      await tx.documentVersion.create({
        data: { documentId: document.id, versionNumber: 1, uploadedById: actor.id, ...stored },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
          entityType: "Document",
          entityId: document.id,
          before: null,
          after: {
            categoryCode: category.code,
            title,
            visibility: category.defaultVisibility,
            assigneeIds: [actor.id],
            ...versionAudit(stored, 1),
          },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      await notifyHrAdmins(tx, actor.id, {
        title: `New document from ${employee.name}`,
        body: `${category.name}: ${title}`,
        href: `/documents/${document.id}`,
      });
      return { id: document.id };
    }),
  );
}

/**
 * HR uploads a document for one or more employees. Employee categories need an
 * "uploaded on behalf of" note and exactly one employee who is not the uploader.
 */
export async function uploadHrDocument(input: {
  actorId: string;
  categoryCode: string;
  employeeIds: readonly string[];
  title: string;
  description?: string | null;
  visibility?: string | null;
  requiresAcknowledgement?: boolean;
  expiresOn?: string | null;
  onBehalfNote?: string | null;
  file: UploadInput;
  meta?: AuditMeta;
}) {
  const actor = await requireHr(input.actorId);
  const category = await requireCategory(input.categoryCode);
  const employeeIds = uniqueIds(input.employeeIds);
  if (employeeIds.length === 0) throw new DocumentError("Choose at least one employee.");
  if (!SHARED_CATEGORIES.has(category.code) && employeeIds.length > 1) {
    throw new DocumentError(`${category.name} documents belong to one employee. Upload one file per person.`);
  }
  if (category.code !== POLICIES && employeeIds.includes(actor.id)) {
    throw new DocumentError(
      category.uploader === "EMPLOYEE"
        ? "Upload your own files from My Space → Documents."
        : "Another HR Admin has to upload documents on your own record.",
    );
  }
  const onBehalfNote =
    category.uploader === "EMPLOYEE" ? requiredText(input.onBehalfNote, "Uploaded on behalf of note", 3, 200) : null;
  const title = requiredText(input.title, "Title", 1, 120);
  const description = optionalText(input.description, "Description", 500);
  const visibility = parseVisibility(input.visibility);
  const requiresAcknowledgement = Boolean(input.requiresAcknowledgement);
  const expiresOn = parseExpiry(input.expiresOn);
  const effective = visibility ?? category.defaultVisibility;
  assertAckAllowed({ requiresAcknowledgement, uploader: category.uploader, visibility: effective });
  await requireAssignableEmployees(getDb(), employeeIds);

  return withStoredFile(input.file, (stored) =>
    getDb().$transaction(async (tx) => {
      await requireAssignableEmployees(tx, employeeIds);
      const document = await tx.document.create({
        data: {
          categoryId: category.id,
          title,
          description,
          visibility,
          requiresAcknowledgement,
          expiresOn,
          createdById: actor.id,
        },
      });
      await tx.documentAssignment.createMany({
        data: employeeIds.map((employeeId) => ({ documentId: document.id, employeeId, assignedById: actor.id })),
      });
      await tx.documentVersion.create({
        data: { documentId: document.id, versionNumber: 1, uploadedById: actor.id, onBehalfNote, ...stored },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
          entityType: "Document",
          entityId: document.id,
          before: null,
          after: {
            categoryCode: category.code,
            title,
            visibility: effective,
            requiresAcknowledgement,
            expiresOn: isoDate(expiresOn),
            assigneeIds: employeeIds,
            onBehalf: Boolean(onBehalfNote),
            ...versionAudit(stored, 1),
          },
          reason: onBehalfNote,
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      if (includesEmployee(effective)) {
        await notifyUsers(
          tx,
          employeeIds.filter((id) => id !== actor.id),
          {
            title: requiresAcknowledgement
              ? "Document to acknowledge"
              : onBehalfNote
                ? "HR uploaded a document for you"
                : "New document",
            body: `${category.name}: ${title}`,
            href: category.uploader === "EMPLOYEE" ? "/my-space/documents" : "/my-space/documents?shelf=hr",
          },
        );
      }
      return { id: document.id };
    }),
  );
}

type VersionPath = { kind: "owner" } | { kind: "hr"; onBehalfNote: string | null };

function versionPath(actor: Principal, row: AccessRow, onBehalfNote: string | null | undefined): VersionPath {
  const facts = factsOf(row);
  if (row.status !== "ACTIVE") {
    if (canOpenDocument(actor, facts)) throw new DocumentError("This document was removed. Upload a new document instead.");
    throw new DocumentAccessError();
  }
  if (row.category.uploader === "EMPLOYEE" && facts.assigneeIds.includes(actor.id) && includesEmployee(facts.visibility)) {
    return { kind: "owner" };
  }
  if (hasHrRights(actor, facts)) {
    const note =
      row.category.uploader === "EMPLOYEE" ? requiredText(onBehalfNote, "Uploaded on behalf of note", 3, 200) : null;
    return { kind: "hr", onBehalfNote: note };
  }
  if (canOpenDocument(actor, facts)) throw new DocumentError("Only HR can upload a new version of this document.");
  throw new DocumentAccessError();
}

/**
 * Re-upload. The version number is picked inside the transaction. If two uploads race,
 * the unique index on (documentId, versionNumber) rejects one and it retries with the next number.
 */
export async function addDocumentVersion(input: {
  actorId: string;
  documentId: string;
  file: UploadInput;
  onBehalfNote?: string | null;
  meta?: AuditMeta;
}) {
  const actor = await activeActor(input.actorId);
  const path = versionPath(actor, await loadForAccess(getDb(), input.documentId), input.onBehalfNote);
  const onBehalfNote = path.kind === "hr" ? path.onBehalfNote : null;

  return withStoredFile(input.file, async (stored) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await getDb().$transaction(async (tx) => {
          const row = await loadForAccess(tx, input.documentId);
          if (versionPath(actor, row, input.onBehalfNote).kind !== path.kind) throw new DocumentAccessError();
          const latest = await tx.documentVersion.aggregate({
            where: { documentId: row.id },
            _max: { versionNumber: true },
          });
          const versionNumber = (latest._max.versionNumber ?? 0) + 1;
          const version = await tx.documentVersion.create({
            data: { documentId: row.id, versionNumber, uploadedById: actor.id, onBehalfNote, ...stored },
          });
          await tx.document.update({ where: { id: row.id }, data: { updatedAt: new Date() } });
          await audit.log(
            {
              actor: actor.id,
              action: AUDIT_ACTIONS.DOCUMENT_VERSION_ADDED,
              entityType: "Document",
              entityId: row.id,
              before: { versionNumber: versionNumber - 1 },
              after: { ...versionAudit(stored, versionNumber), onBehalf: Boolean(onBehalfNote) },
              reason: onBehalfNote,
              ipAddress: input.meta?.ipAddress,
              userAgent: input.meta?.userAgent,
            },
            tx,
          );
          const facts = factsOf(row);
          if (row.requiresAcknowledgement && includesEmployee(facts.visibility)) {
            await notifyUsers(
              tx,
              facts.assigneeIds.filter((id) => id !== actor.id),
              {
                title: "Updated document to acknowledge",
                body: `${row.category.name}: ${row.title} (version ${versionNumber})`,
                href: "/my-space/documents?shelf=hr",
              },
            );
          }
          if (path.kind === "owner") {
            await notifyHrAdmins(tx, actor.id, {
              title: `New version from ${actor.name || "an employee"}`,
              body: `${row.category.name}: ${row.title} (version ${versionNumber})`,
              href: `/documents/${row.id}`,
            });
          }
          return { id: version.id, versionNumber };
        });
      } catch (error) {
        if (attempt < VERSION_RETRIES && isVersionConflict(error)) continue;
        throw error;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Details, assignment, removal
// ---------------------------------------------------------------------------

async function loadForHr(actor: Principal, documentId: string): Promise<AccessRow> {
  const row = await loadForAccess(getDb(), documentId);
  if (!hasHrRights(actor, factsOf(row))) throw new DocumentAccessError();
  return row;
}

function assertActive(row: AccessRow) {
  if (row.status !== "ACTIVE") throw new DocumentError("This document was removed and can no longer be changed.");
}

/** HR only. This is the only way to change a visibility override. */
export async function updateDocumentDetails(input: {
  actorId: string;
  documentId: string;
  title: string;
  description?: string | null;
  visibility?: string | null;
  requiresAcknowledgement?: boolean;
  expiresOn?: string | null;
  meta?: AuditMeta;
}) {
  const actor = await requireHr(input.actorId);
  const row = await loadForHr(actor, input.documentId);
  assertActive(row);
  const next = {
    title: requiredText(input.title, "Title", 1, 120),
    description: optionalText(input.description, "Description", 500),
    visibility: parseVisibility(input.visibility),
    requiresAcknowledgement: Boolean(input.requiresAcknowledgement),
    expiresOn: parseExpiry(input.expiresOn),
  };
  assertAckAllowed({
    requiresAcknowledgement: next.requiresAcknowledgement,
    uploader: row.category.uploader,
    visibility: next.visibility ?? row.category.defaultVisibility,
  });
  const before = {
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    requiresAcknowledgement: row.requiresAcknowledgement,
    expiresOn: isoDate(row.expiresOn),
  };
  const after = { ...next, expiresOn: isoDate(next.expiresOn) };
  if (JSON.stringify(before) === JSON.stringify(after)) return { id: row.id };

  return getDb().$transaction(async (tx) => {
    await tx.document.update({ where: { id: row.id }, data: next });
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.DOCUMENT_UPDATED,
        entityType: "Document",
        entityId: row.id,
        before,
        after,
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    return { id: row.id };
  });
}

async function assignInTx(
  tx: Tx,
  input: {
    actorId: string;
    row: AccessRow;
    employeeIds: readonly string[];
    reason?: string | null;
    meta?: AuditMeta;
  },
): Promise<number> {
  const existing = new Set(
    (await tx.documentAssignment.findMany({ where: { documentId: input.row.id }, select: { employeeId: true } })).map(
      (assignment) => assignment.employeeId,
    ),
  );
  const added = input.employeeIds.filter((id) => !existing.has(id));
  if (added.length === 0) return 0;
  await tx.documentAssignment.createMany({
    data: added.map((employeeId) => ({ documentId: input.row.id, employeeId, assignedById: input.actorId })),
    skipDuplicates: true,
  });
  await audit.log(
    {
      actor: input.actorId,
      action: AUDIT_ACTIONS.DOCUMENT_ASSIGNED,
      entityType: "Document",
      entityId: input.row.id,
      before: { assigneeCount: existing.size },
      after: { added, assigneeCount: existing.size + added.length },
      reason: input.reason ?? null,
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
    },
    tx,
  );
  if (includesEmployee(effectiveVisibility(input.row, input.row.category))) {
    await notifyUsers(
      tx,
      added.filter((id) => id !== input.actorId),
      {
        title: input.row.requiresAcknowledgement ? "Document to acknowledge" : "New document",
        body: `${input.row.category.name}: ${input.row.title}`,
        href: "/my-space/documents?shelf=hr",
      },
    );
  }
  return added.length;
}

function assertShared(actor: Principal, row: AccessRow, employeeIds: readonly string[]) {
  if (!SHARED_CATEGORIES.has(row.category.code)) {
    throw new DocumentError(`${row.category.name} documents belong to one employee.`);
  }
  if (row.category.code !== POLICIES && employeeIds.includes(actor.id)) {
    throw new DocumentError("Another HR Admin has to assign documents to your own record.");
  }
}

export async function assignDocument(input: {
  actorId: string;
  documentId: string;
  employeeIds: readonly string[];
  meta?: AuditMeta;
}) {
  const actor = await requireHr(input.actorId);
  const row = await loadForHr(actor, input.documentId);
  assertActive(row);
  const employeeIds = uniqueIds(input.employeeIds);
  if (employeeIds.length === 0) throw new DocumentError("Choose at least one employee.");
  assertShared(actor, row, employeeIds);
  return getDb().$transaction(async (tx) => {
    await requireAssignableEmployees(tx, employeeIds);
    return { added: await assignInTx(tx, { actorId: actor.id, row, employeeIds, meta: input.meta }) };
  });
}

/** Active employees who do not have this document yet. Policies include the HR Admin; other categories do not. */
async function missingEmployeeIds(db: Tx | ReturnType<typeof getDb>, actor: Principal, row: AccessRow): Promise<string[]> {
  const rows = await db.employee.findMany({
    where: {
      status: "ACTIVE",
      documentAssignments: { none: { documentId: row.id } },
      ...(row.category.code === POLICIES ? {} : { id: { not: actor.id } }),
    },
    select: { id: true },
  });
  return rows.map((employee) => employee.id);
}

export async function assignDocumentToMissing(input: { actorId: string; documentId: string; meta?: AuditMeta }) {
  const actor = await requireHr(input.actorId);
  const row = await loadForHr(actor, input.documentId);
  assertActive(row);
  assertShared(actor, row, []);
  return getDb().$transaction(async (tx) => {
    const employeeIds = await missingEmployeeIds(tx, actor, row);
    const added = await assignInTx(tx, {
      actorId: actor.id,
      row,
      employeeIds,
      reason: "Assigned to active employees who did not have it",
      meta: input.meta,
    });
    return { added };
  });
}

/**
 * Called inside the employee transaction when someone is created as, or becomes, ACTIVE.
 * Assigns every current Policy that asks for an acknowledgement.
 */
export async function assignOpenPoliciesToEmployee(
  tx: Tx,
  input: { employeeId: string; actorId: string; reason: string; meta?: AuditMeta },
): Promise<number> {
  const policies = await tx.document.findMany({
    where: {
      status: "ACTIVE",
      requiresAcknowledgement: true,
      category: { code: POLICIES },
      assignments: { none: { employeeId: input.employeeId } },
    },
    include: accessInclude,
  });
  let assigned = 0;
  for (const row of policies) {
    if (!includesEmployee(effectiveVisibility(row, row.category))) continue;
    assigned += await assignInTx(tx, {
      actorId: input.actorId,
      row,
      employeeIds: [input.employeeId],
      reason: input.reason,
      meta: input.meta,
    });
  }
  return assigned;
}

/** Soft delete. The owner can remove a file they uploaded themselves; HR can remove any it manages. */
export async function removeDocument(input: { actorId: string; documentId: string; reason: string; meta?: AuditMeta }) {
  const actor = await activeActor(input.actorId);
  const row = await loadForAccess(getDb(), input.documentId);
  const facts = factsOf(row);
  const ownUpload =
    row.category.uploader === "EMPLOYEE" &&
    row.createdById === actor.id &&
    facts.assigneeIds.includes(actor.id) &&
    includesEmployee(facts.visibility);
  if (!ownUpload && !hasHrRights(actor, facts)) {
    if (canOpenDocument(actor, facts)) throw new DocumentError("Only HR can remove this document.");
    throw new DocumentAccessError();
  }
  if (row.status !== "ACTIVE") throw new DocumentError("This document is already removed.");
  const reason = requiredText(input.reason, "Reason", 3, 300);

  return getDb().$transaction(async (tx) => {
    const updated = await tx.document.updateMany({
      where: { id: row.id, status: "ACTIVE" },
      data: { status: "REMOVED", removedAt: new Date(), removedById: actor.id, removedReason: reason },
    });
    if (updated.count === 0) throw new DocumentError("This document is already removed.");
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.DOCUMENT_REMOVED,
        entityType: "Document",
        entityId: row.id,
        before: { status: "ACTIVE" },
        after: { status: "REMOVED" },
        reason,
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    return { id: row.id };
  });
}

// ---------------------------------------------------------------------------
// Acknowledgement
// ---------------------------------------------------------------------------

/** The employee acknowledges one specific version, which must be the current one. */
export async function acknowledgeDocument(input: {
  actorId: string;
  documentId: string;
  versionId: string;
  meta?: AuditMeta;
}) {
  const actor = await activeActor(input.actorId);
  return getDb().$transaction(async (tx) => {
    const row = await loadForAccess(tx, input.documentId);
    const facts = factsOf(row);
    const employeeView =
      row.status === "ACTIVE" && facts.assigneeIds.includes(actor.id) && includesEmployee(facts.visibility);
    if (!employeeView) throw new DocumentAccessError();
    if (!row.requiresAcknowledgement) throw new DocumentError("This document does not need an acknowledgement.");
    const current = await tx.documentVersion.findFirst({
      where: { documentId: row.id },
      orderBy: { versionNumber: "desc" },
      select: { id: true, versionNumber: true },
    });
    if (!current || current.id !== input.versionId) {
      throw new DocumentError("A newer version was published. Open it and acknowledge that one.");
    }
    try {
      const ack = await tx.documentAcknowledgement.create({
        data: { versionId: current.id, userId: actor.id, ipAddress: input.meta?.ipAddress ?? null },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.DOCUMENT_ACKNOWLEDGED,
          entityType: "Document",
          entityId: row.id,
          before: null,
          after: { versionId: current.id, versionNumber: current.versionNumber, acknowledgementId: ack.id },
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return { id: ack.id, versionNumber: current.versionNumber };
    } catch (error) {
      if (isUniqueConflict(error)) throw new DocumentError("You already acknowledged this version.");
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Opening a file
// ---------------------------------------------------------------------------

/**
 * Checks access, writes DOCUMENT_VIEWED for sensitive categories, and returns a signed URL
 * that expires after SIGNED_URL_TTL_SECONDS. Employees can open only the current version.
 */
export async function openDocumentFile(input: {
  actorId: string;
  documentId: string;
  versionNumber?: number | null;
  meta?: AuditMeta;
}): Promise<{ url: string }> {
  const actor = await activeActor(input.actorId);
  const row = await loadForAccess(getDb(), input.documentId);
  const facts = factsOf(row);
  if (!canOpenDocument(actor, facts)) throw new DocumentAccessError();
  const hr = hasHrRights(actor, facts) && includesHr(facts.visibility);
  if (!hr) {
    const employee = await getDb().employee.findUnique({ where: { id: actor.id }, select: { status: true } });
    if (!employee || employee.status === "EXITED") throw new DocumentAccessError();
  }
  const current = await getDb().documentVersion.findFirst({
    where: { documentId: row.id },
    orderBy: { versionNumber: "desc" },
  });
  if (!current) throw new DocumentAccessError();
  const wanted = input.versionNumber ?? current.versionNumber;
  if (wanted !== current.versionNumber && !hr) throw new DocumentAccessError();
  const version =
    wanted === current.versionNumber
      ? current
      : await getDb().documentVersion.findUnique({
          where: { documentId_versionNumber: { documentId: row.id, versionNumber: wanted } },
        });
  if (!version) throw new DocumentAccessError();

  if (row.category.isSensitive) {
    await audit.log({
      actor: actor.id,
      action: AUDIT_ACTIONS.DOCUMENT_VIEWED,
      entityType: "Document",
      entityId: row.id,
      before: null,
      after: { categoryCode: row.category.code, versionNumber: version.versionNumber, as: hr ? "HR" : "EMPLOYEE" },
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
    });
  }
  const url = await getStorage().signedUrl(version.storageKey, {
    fileName: version.fileName,
    contentType: version.contentType,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
  return { url };
}

/** Route handler body for GET /api/documents/{id}/file. Anything not allowed is a plain 404. */
export async function documentFileResponse(input: {
  actor: Principal | null;
  documentId: string;
  version: string | null;
  requestUrl: string;
  meta?: AuditMeta;
}): Promise<Response> {
  const noStore = { "Cache-Control": "no-store" };
  if (!input.actor || input.actor.status !== "ACTIVE") {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }
  const versionNumber = input.version ? Number.parseInt(input.version, 10) : null;
  if (input.version && (!Number.isInteger(versionNumber) || (versionNumber ?? 0) < 1)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  }
  try {
    const { url } = await openDocumentFile({
      actorId: input.actor.id,
      documentId: input.documentId,
      versionNumber,
      meta: input.meta,
    });
    return new Response(null, {
      status: 303,
      headers: { ...noStore, Location: new URL(url, input.requestUrl).toString() },
    });
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Read models. None of these include storage keys.
// ---------------------------------------------------------------------------

export type DocumentCategoryOption = {
  code: string;
  name: string;
  uploader: DocumentUploader;
  defaultVisibility: DocumentVisibility;
  shared: boolean;
};

export async function listDocumentCategories(): Promise<DocumentCategoryOption[]> {
  const rows = await getDb().documentCategory.findMany({ orderBy: { sortOrder: "asc" } });
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    uploader: row.uploader,
    defaultVisibility: row.defaultVisibility,
    shared: SHARED_CATEGORIES.has(row.code),
  }));
}

export type VersionView = {
  id: string;
  versionNumber: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string;
  uploadedByHr: boolean;
  onBehalfNote: string | null;
};

const versionSelect = {
  id: true,
  versionNumber: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedById: true,
  onBehalfNote: true,
  uploadedBy: { select: { name: true } },
} satisfies Prisma.DocumentVersionSelect;

type VersionRow = Prisma.DocumentVersionGetPayload<{ select: typeof versionSelect }>;

function toVersionView(row: VersionRow, ownerIds: readonly string[]): VersionView {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.createdAt.toISOString(),
    uploadedByName: row.uploadedBy.name,
    uploadedByHr: !ownerIds.includes(row.uploadedById),
    onBehalfNote: row.onBehalfNote,
  };
}

export type MyDocumentRow = {
  id: string;
  title: string;
  description: string | null;
  categoryName: string;
  expiresOn: string | null;
  requiresAcknowledgement: boolean;
  current: VersionView;
  acknowledgedAt: string | null;
  pendingAcknowledgement: boolean;
  canReupload: boolean;
  canRemove: boolean;
};

export async function listMyDocuments(actorId: string) {
  const actor = await activeActor(actorId);
  const rows = await getDb().document.findMany({
    where: { status: "ACTIVE", assignments: { some: { employeeId: actor.id } } },
    include: {
      category: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { ...versionSelect, acknowledgements: { where: { userId: actor.id }, select: { acknowledgedAt: true } } },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  const mine: MyDocumentRow[] = [];
  const fromHr: MyDocumentRow[] = [];
  for (const row of rows) {
    const current = row.versions[0];
    if (!current || !includesEmployee(effectiveVisibility(row, row.category))) continue;
    const acknowledgedAt = current.acknowledgements[0]?.acknowledgedAt ?? null;
    const view: MyDocumentRow = {
      id: row.id,
      title: row.title,
      description: row.description,
      categoryName: row.category.name,
      expiresOn: isoDate(row.expiresOn),
      requiresAcknowledgement: row.requiresAcknowledgement,
      current: toVersionView(current, [actor.id]),
      acknowledgedAt: acknowledgedAt?.toISOString() ?? null,
      pendingAcknowledgement: row.requiresAcknowledgement && !acknowledgedAt,
      canReupload: row.category.uploader === "EMPLOYEE",
      canRemove: row.category.uploader === "EMPLOYEE" && row.createdById === actor.id,
    };
    (row.category.uploader === "EMPLOYEE" ? mine : fromHr).push(view);
  }
  return { mine, fromHr, pendingCount: fromHr.filter((row) => row.pendingAcknowledgement).length };
}

export type HrDocumentFilters = {
  categoryCode?: string;
  employeeId?: string;
  status?: string;
  pendingOnly?: boolean;
};

export type HrDocumentRow = {
  id: string;
  title: string;
  categoryName: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  assigneeSummary: string;
  versionNumber: number;
  requiresAcknowledgement: boolean;
  acknowledged: number;
  pending: number;
  expiresOn: string | null;
  updatedAt: string;
};

/** Documents HR manages. Non-policy documents on the HR Admin's own record are left out. */
function hrScope(actor: Principal): Prisma.DocumentWhereInput {
  return {
    NOT: { AND: [{ category: { code: { not: POLICIES } } }, { assignments: { some: { employeeId: actor.id } } }] },
  };
}

export async function listDocumentsForHr(actorId: string, filters: HrDocumentFilters): Promise<HrDocumentRow[]> {
  const actor = await requireHr(actorId);
  const status = filters.status === "REMOVED" || filters.status === "ALL" ? filters.status : "ACTIVE";
  const rows = await getDb().document.findMany({
    where: {
      AND: [
        hrScope(actor),
        status === "ALL" ? {} : { status },
        filters.categoryCode ? { category: { code: filters.categoryCode } } : {},
        filters.employeeId ? { assignments: { some: { employeeId: filters.employeeId } } } : {},
        filters.pendingOnly ? { requiresAcknowledgement: true, status: "ACTIVE" } : {},
      ],
    },
    include: {
      category: true,
      assignments: { select: { employeeId: true, employee: { select: { name: true, status: true } } } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { versionNumber: true, acknowledgements: { select: { userId: true } } },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });
  const views = rows.map((row) => {
    const current = row.versions[0];
    const ackIds = new Set(current?.acknowledgements.map((ack) => ack.userId) ?? []);
    const open = row.assignments.filter((assignment) => assignment.employee.status !== "EXITED");
    const acknowledged = open.filter((assignment) => ackIds.has(assignment.employeeId)).length;
    const first = row.assignments[0]?.employee.name ?? "—";
    return {
      id: row.id,
      title: row.title,
      categoryName: row.category.name,
      status: row.status,
      visibility: effectiveVisibility(row, row.category),
      assigneeSummary: row.assignments.length > 1 ? `${first} and ${row.assignments.length - 1} more` : first,
      versionNumber: current?.versionNumber ?? 0,
      requiresAcknowledgement: row.requiresAcknowledgement,
      acknowledged,
      pending: row.requiresAcknowledgement ? open.length - acknowledged : 0,
      expiresOn: isoDate(row.expiresOn),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return filters.pendingOnly ? views.filter((row) => row.pending > 0) : views;
}

export type HrAssigneeView = {
  employeeId: string;
  name: string;
  employeeCode: string;
  status: EmployeeStatus;
  assignedAt: string;
  acknowledgedAt: string | null;
};

export type HrDocumentDetail = {
  id: string;
  title: string;
  description: string | null;
  category: DocumentCategoryOption;
  status: DocumentStatus;
  visibilityOverride: DocumentVisibility | null;
  visibility: DocumentVisibility;
  canOpen: boolean;
  requiresAcknowledgement: boolean;
  expiresOn: string | null;
  createdAt: string;
  createdByName: string;
  removedAt: string | null;
  removedByName: string | null;
  removedReason: string | null;
  versions: (VersionView & { acknowledgements: number })[];
  assignees: HrAssigneeView[];
  missingCount: number;
};

export async function getDocumentForHr(actorId: string, documentId: string): Promise<HrDocumentDetail> {
  const actor = await requireHr(actorId);
  const access = await loadForHr(actor, documentId);
  const row = await getDb().document.findUniqueOrThrow({
    where: { id: access.id },
    include: {
      category: true,
      createdBy: { select: { name: true } },
      removedBy: { select: { name: true } },
      assignments: {
        include: { employee: { select: { name: true, employeeCode: true, status: true } } },
        orderBy: { employee: { name: "asc" } },
      },
      versions: {
        orderBy: { versionNumber: "desc" },
        select: { ...versionSelect, acknowledgements: { select: { userId: true, acknowledgedAt: true } } },
      },
    },
  });
  const ownerIds = row.assignments.map((assignment) => assignment.employeeId);
  const visibility = effectiveVisibility(row, row.category);
  const current = row.versions[0];
  const acks = new Map(current?.acknowledgements.map((ack) => [ack.userId, ack.acknowledgedAt]) ?? []);
  const shared = SHARED_CATEGORIES.has(row.category.code);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: {
      code: row.category.code,
      name: row.category.name,
      uploader: row.category.uploader,
      defaultVisibility: row.category.defaultVisibility,
      shared,
    },
    status: row.status,
    visibilityOverride: row.visibility,
    visibility,
    canOpen: includesHr(visibility),
    requiresAcknowledgement: row.requiresAcknowledgement,
    expiresOn: isoDate(row.expiresOn),
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy.name,
    removedAt: row.removedAt?.toISOString() ?? null,
    removedByName: row.removedBy?.name ?? null,
    removedReason: row.removedReason,
    versions: row.versions.map((version) => ({
      ...toVersionView(version, row.category.uploader === "EMPLOYEE" ? ownerIds : []),
      acknowledgements: version.acknowledgements.length,
    })),
    assignees: row.assignments.map((assignment) => ({
      employeeId: assignment.employeeId,
      name: assignment.employee.name,
      employeeCode: assignment.employee.employeeCode,
      status: assignment.employee.status,
      assignedAt: assignment.assignedAt.toISOString(),
      acknowledgedAt: acks.get(assignment.employeeId)?.toISOString() ?? null,
    })),
    missingCount: shared && row.status === "ACTIVE" ? (await missingEmployeeIds(getDb(), actor, access)).length : 0,
  };
}

export type AssigneeChoice = { id: string; name: string; employeeCode: string; status: EmployeeStatus };

export async function listAssigneeChoices(actorId: string): Promise<AssigneeChoice[]> {
  await requireHr(actorId);
  return getDb().employee.findMany({
    where: { status: { in: ASSIGNABLE_STATUSES } },
    select: { id: true, name: true, employeeCode: true, status: true },
    orderBy: { name: "asc" },
  });
}

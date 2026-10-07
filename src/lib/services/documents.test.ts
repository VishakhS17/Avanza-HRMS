import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { allowedEmailDomain } from "@/lib/services/auth-policy";
import { requireActiveActor } from "@/lib/services/actor";
import { DocumentAccessError, DocumentError } from "@/lib/services/document-errors";
import {
  acknowledgeDocument,
  addDocumentVersion,
  assignDocument,
  assignDocumentToMissing,
  documentFileResponse,
  getDocumentForHr,
  listDocumentsForHr,
  listMyDocuments,
  openDocumentFile,
  removeDocument,
  updateDocumentDetails,
  uploadHrDocument,
  uploadOwnDocument,
} from "@/lib/services/documents";
import { changeEmployeeStatus, createEmployee } from "@/lib/services/employees";
import { createDepartment, createDesignation, createLocation } from "@/lib/services/organization";
import { serveLocalFile } from "@/lib/storage/local";
import { trackTestData } from "@/test/fixtures";

if (!process.env.EMPLOYEE_DATA_KEY) {
  process.env.EMPLOYEE_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
}
const storageDir = mkdtempSync(path.join(tmpdir(), "avanza-documents-"));
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = storageDir;
process.env.STORAGE_SIGNING_SECRET = "documents-test-secret-that-is-long-enough";
after(() => rmSync(storageDir, { recursive: true, force: true }));

const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.4\n${body}`);
const file = (body: string, name = "file.pdf") => ({ name, type: "application/pdf", bytes: pdf(body) });

function tokenOf(url: string): string {
  return new URL(url, "http://localhost").searchParams.get("token") ?? "";
}

async function download(actorId: string, documentId: string, versionNumber?: number) {
  const { url } = await openDocumentFile({ actorId, documentId, versionNumber });
  const response = await serveLocalFile(tokenOf(url));
  return { url, response, text: response.status === 200 ? await response.text() : "" };
}

describe("documents", () => {
  const data = trackTestData();
  const { userIds, departmentIds, designationIds, locationIds } = data;

  /** HR without an employee record, an HR Admin who is also an employee, a manager, two reports, a Super Admin. */
  async function team() {
    const domain = allowedEmailDomain();
    const hr = await data.user(["HR_ADMIN", "EMPLOYEE"], "Docs HR");
    const superAdmin = await data.user(["SUPER_ADMIN", "EMPLOYEE"], "Docs Super Admin");
    const suffix = crypto.randomUUID().slice(0, 8);
    const department = await createDepartment({ actorId: hr.id, name: `Docs ${suffix}` });
    const designation = await createDesignation({ actorId: hr.id, name: `Docs role ${suffix}` });
    const location = await createLocation({ actorId: hr.id, name: `Docs site ${suffix}`, city: "Pune" });
    departmentIds.push(department.id);
    designationIds.push(designation.id);
    locationIds.push(location.id);
    const person = async (code: string, name: string, extra: Record<string, unknown> = {}) => {
      const row = await createEmployee({
        actorId: hr.id,
        departmentId: department.id,
        designationId: designation.id,
        locationId: location.id,
        employmentType: "FULL_TIME",
        joiningDate: "2020-01-15",
        status: "ACTIVE",
        employeeCode: `${code}-${suffix}`,
        name,
        workEmail: `${code.toLowerCase()}-${suffix}@${domain}`,
        ...extra,
      });
      userIds.push(row.id);
      return row;
    };
    const manager = await person("DM", "Dev Manager");
    const employee = await person("DA", "Asha Employee", { reportingManagerId: manager.id });
    const other = await person("DB", "Bala Other", { reportingManagerId: manager.id });
    const hrEmployee = await person("DH", "Hema HR");
    await getDb().user.update({ where: { id: hrEmployee.id }, data: { roles: ["HR_ADMIN", "EMPLOYEE"] } });
    return { hr, superAdmin, manager, employee, other, hrEmployee, person };
  }

  it("an employee cannot reach another employee's document by ID or URL", async () => {
    const { employee, other } = await team();
    const doc = await uploadOwnDocument({ actorId: employee.id, categoryCode: "IDENTITY", title: "Aadhaar", file: file("asha-id") });

    await assert.rejects(openDocumentFile({ actorId: other.id, documentId: doc.id }), DocumentAccessError);
    await assert.rejects(addDocumentVersion({ actorId: other.id, documentId: doc.id, file: file("x") }), DocumentAccessError);
    await assert.rejects(removeDocument({ actorId: other.id, documentId: doc.id, reason: "mine now" }), DocumentAccessError);
    const versionId = (await getDb().documentVersion.findFirstOrThrow({ where: { documentId: doc.id } })).id;
    await assert.rejects(acknowledgeDocument({ actorId: other.id, documentId: doc.id, versionId }), DocumentAccessError);
    assert.equal((await listMyDocuments(other.id)).mine.length, 0);

    const otherPrincipal = await requireActiveActor(other.id);
    const guessed = await documentFileResponse({ actor: otherPrincipal, documentId: doc.id, version: "1", requestUrl: "http://localhost/x" });
    const missing = await documentFileResponse({ actor: otherPrincipal, documentId: "does-not-exist", version: null, requestUrl: "http://localhost/x" });
    assert.equal(guessed.status, 404);
    assert.equal(missing.status, 404);
    assert.equal(await guessed.text(), await missing.text());
    const anonymous = await documentFileResponse({ actor: null, documentId: doc.id, version: null, requestUrl: "http://localhost/x" });
    assert.equal(anonymous.status, 401);

    const own = await download(employee.id, doc.id);
    assert.equal(own.response.status, 200);
    assert.equal(own.text, "%PDF-1.4\nasha-id");
  });

  it("managers and Super Admins cannot open employee documents", async () => {
    const { hr, manager, superAdmin, employee } = await team();
    const own = await uploadOwnDocument({ actorId: employee.id, categoryCode: "ADDRESS", title: "Utility bill", file: file("bill") });
    const payslip = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "PAYSLIPS",
      employeeIds: [employee.id],
      title: "September payslip",
      file: file("payslip"),
    });
    for (const documentId of [own.id, payslip.id]) {
      await assert.rejects(openDocumentFile({ actorId: manager.id, documentId }), DocumentAccessError);
      await assert.rejects(openDocumentFile({ actorId: superAdmin.id, documentId }), DocumentAccessError);
      await assert.rejects(getDocumentForHr(manager.id, documentId), DocumentAccessError);
      await assert.rejects(getDocumentForHr(superAdmin.id, documentId), DocumentAccessError);
    }
    await assert.rejects(listDocumentsForHr(manager.id, {}), DocumentAccessError);
    await assert.rejects(listDocumentsForHr(superAdmin.id, {}), DocumentAccessError);
    assert.equal((await listMyDocuments(manager.id)).mine.length, 0);
  });

  it("applies category visibility and per-document overrides, which only HR can change", async () => {
    const { hr, employee } = await team();
    const hrOnly = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "OTHER_HR",
      employeeIds: [employee.id],
      title: "Background check",
      file: file("check"),
    });
    await assert.rejects(openDocumentFile({ actorId: employee.id, documentId: hrOnly.id }), DocumentAccessError);
    assert.equal((await listMyDocuments(employee.id)).fromHr.length, 0);
    assert.equal((await download(hr.id, hrOnly.id)).response.status, 200);

    const own = await uploadOwnDocument({ actorId: employee.id, categoryCode: "EDUCATION", title: "Degree", file: file("degree") });
    await assert.rejects(
      updateDocumentDetails({ actorId: employee.id, documentId: own.id, title: "Degree", visibility: "EMPLOYEE_ONLY" }),
      DocumentAccessError,
    );
    await updateDocumentDetails({ actorId: hr.id, documentId: own.id, title: "Degree", visibility: "EMPLOYEE_ONLY" });
    await assert.rejects(openDocumentFile({ actorId: hr.id, documentId: own.id }), DocumentAccessError);
    assert.equal((await download(employee.id, own.id)).response.status, 200);
    const updated = await getDb().auditLog.findFirst({ where: { action: "DOCUMENT_UPDATED", entityId: own.id } });
    assert.equal((updated?.after as { visibility: string }).visibility, "EMPLOYEE_ONLY");

    await assert.rejects(
      uploadHrDocument({
        actorId: hr.id,
        categoryCode: "POLICIES",
        employeeIds: [employee.id],
        title: "Hidden policy",
        visibility: "HR_ONLY",
        requiresAcknowledgement: true,
        file: file("p"),
      }),
      /HR-only document cannot ask/,
    );
  });

  it("enforces who uploads what, including HR uploads on an employee's behalf", async () => {
    const { hr, employee, other, hrEmployee } = await team();
    await assert.rejects(
      uploadOwnDocument({ actorId: employee.id, categoryCode: "PAYSLIPS", title: "Fake payslip", file: file("x") }),
      /HR uploads/,
    );
    await assert.rejects(
      uploadHrDocument({ actorId: employee.id, categoryCode: "PAYSLIPS", employeeIds: [employee.id], title: "x", file: file("x") }),
      DocumentAccessError,
    );
    await assert.rejects(
      uploadHrDocument({ actorId: hr.id, categoryCode: "IDENTITY", employeeIds: [employee.id], title: "PAN", file: file("x") }),
      /Uploaded on behalf of note/,
    );
    const onBehalf = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "IDENTITY",
      employeeIds: [employee.id],
      title: "PAN card",
      onBehalfNote: "Paper copy collected at the Pune depot",
      file: file("pan"),
    });
    const version = await getDb().documentVersion.findFirstOrThrow({ where: { documentId: onBehalf.id } });
    assert.equal(version.uploadedById, hr.id);
    assert.equal(version.onBehalfNote, "Paper copy collected at the Pune depot");
    const uploadAudit = await getDb().auditLog.findFirstOrThrow({ where: { action: "DOCUMENT_UPLOADED", entityId: onBehalf.id } });
    assert.equal(uploadAudit.reason, "Paper copy collected at the Pune depot");
    assert.equal(uploadAudit.actorUserId, hr.id);
    const mine = (await listMyDocuments(employee.id)).mine.find((row) => row.id === onBehalf.id);
    assert.equal(mine?.current.uploadedByHr, true);
    assert.equal(mine?.current.uploadedByName, "Docs HR");
    assert.equal(mine?.canRemove, false);

    await assert.rejects(
      uploadHrDocument({ actorId: hr.id, categoryCode: "PAYSLIPS", employeeIds: [employee.id, other.id], title: "x", file: file("x") }),
      /belong to one employee/,
    );
    await assert.rejects(
      uploadHrDocument({ actorId: hrEmployee.id, categoryCode: "PAYSLIPS", employeeIds: [hrEmployee.id], title: "Own payslip", file: file("x") }),
      /Another HR Admin/,
    );
    await assert.rejects(
      uploadHrDocument({
        actorId: hrEmployee.id,
        categoryCode: "IDENTITY",
        employeeIds: [hrEmployee.id],
        title: "Own ID",
        onBehalfNote: "myself",
        file: file("x"),
      }),
      /My Space/,
    );
    const policy = await uploadHrDocument({
      actorId: hrEmployee.id,
      categoryCode: "POLICIES",
      employeeIds: [hrEmployee.id, employee.id],
      title: "Leave policy",
      file: file("policy"),
    });
    assert.ok(policy.id);

    const aboutHr = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "OTHER_HR",
      employeeIds: [hrEmployee.id],
      title: "Warning letter",
      file: file("warning"),
    });
    await assert.rejects(openDocumentFile({ actorId: hrEmployee.id, documentId: aboutHr.id }), DocumentAccessError);
    await assert.rejects(getDocumentForHr(hrEmployee.id, aboutHr.id), DocumentAccessError);
    await assert.rejects(
      updateDocumentDetails({ actorId: hrEmployee.id, documentId: aboutHr.id, title: "x", visibility: "EMPLOYEE_AND_HR" }),
      DocumentAccessError,
    );
    assert.ok(!(await listDocumentsForHr(hrEmployee.id, {})).some((row) => row.id === aboutHr.id));
    assert.ok((await listDocumentsForHr(hr.id, {})).some((row) => row.id === aboutHr.id));
  });

  it("signed URLs expire, are tied to one file, and never expose the storage key", async () => {
    const { hr, employee, other } = await team();
    const first = await uploadOwnDocument({ actorId: employee.id, categoryCode: "CERTIFICATES", title: "Forklift", file: file("first") });
    const second = await uploadOwnDocument({ actorId: other.id, categoryCode: "CERTIFICATES", title: "HGV", file: file("second") });
    const keys = (await getDb().documentVersion.findMany({ where: { documentId: { in: [first.id, second.id] } } })).map((row) => row.storageKey);

    const { url } = await openDocumentFile({ actorId: employee.id, documentId: first.id });
    const token = tokenOf(url);
    assert.equal((await serveLocalFile(token)).status, 200);
    assert.equal((await serveLocalFile(token, Date.now() + 61_000)).status, 410);

    const otherToken = tokenOf((await openDocumentFile({ actorId: other.id, documentId: second.id })).url);
    const spliced = Buffer.concat([
      Buffer.from(token, "base64url").subarray(0, 28),
      Buffer.from(otherToken, "base64url").subarray(28),
    ]).toString("base64url");
    assert.equal((await serveLocalFile(spliced)).status, 404);
    assert.equal(await (await serveLocalFile(token)).text(), "%PDF-1.4\nfirst");

    const principal = await requireActiveActor(employee.id);
    const redirect = await documentFileResponse({ actor: principal, documentId: first.id, version: null, requestUrl: "http://localhost/api" });
    assert.equal(redirect.status, 303);
    assert.equal(redirect.headers.get("cache-control"), "no-store");
    const responses = [
      url,
      redirect.headers.get("location") ?? "",
      JSON.stringify(await listMyDocuments(employee.id)),
      JSON.stringify(await listMyDocuments(other.id)),
      JSON.stringify(await listDocumentsForHr(hr.id, { status: "ALL" })),
      JSON.stringify(await getDocumentForHr(hr.id, first.id)),
      JSON.stringify(await getDocumentForHr(hr.id, second.id)),
    ];
    for (const body of responses) {
      assert.doesNotMatch(body, /storageKey/);
      for (const key of keys) {
        assert.ok(!body.includes(key), "storage key leaked");
        assert.ok(!body.includes(key.replace("documents/", "")), "storage key leaked");
      }
    }
  });

  it("sanitizes the file name in Content-Disposition", async () => {
    const { employee } = await team();
    const doc = await uploadOwnDocument({
      actorId: employee.id,
      categoryCode: "IDENTITY",
      title: "Passport",
      file: { name: '..\\..\\pass"port\r\nX-Injected: 1;ünï.pdf', type: "application/pdf", bytes: pdf("passport") },
    });
    const version = await getDb().documentVersion.findFirstOrThrow({ where: { documentId: doc.id } });
    assert.doesNotMatch(version.fileName, /[\\/\r\n"]/);
    const { response } = await download(employee.id, doc.id);
    const header = response.headers.get("content-disposition") ?? "";
    assert.ok(header.startsWith("attachment; filename=\""));
    assert.doesNotMatch(header, /[\r\n]/);
    assert.doesNotMatch(header, /\.\.[\\/]/);
    const ascii = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
    assert.doesNotMatch(ascii, /[^\x20-\x7e]|[";\\]/);
    assert.match(header, /filename\*=UTF-8''/);
  });

  it("an exited or deactivated employee cannot download", async () => {
    const { hr, employee, other } = await team();
    const exitedDoc = await uploadOwnDocument({ actorId: employee.id, categoryCode: "IDENTITY", title: "ID", file: file("e") });
    const deactivatedDoc = await uploadOwnDocument({ actorId: other.id, categoryCode: "IDENTITY", title: "ID", file: file("d") });
    const stale = await requireActiveActor(employee.id);
    const staleOther = await requireActiveActor(other.id);

    await changeEmployeeStatus({ actorId: hr.id, employeeId: employee.id, status: "EXITED" });
    await getDb().user.update({ where: { id: other.id }, data: { status: "INACTIVE" } });

    await assert.rejects(openDocumentFile({ actorId: employee.id, documentId: exitedDoc.id }), DocumentAccessError);
    await assert.rejects(openDocumentFile({ actorId: other.id, documentId: deactivatedDoc.id }), DocumentAccessError);
    for (const [actor, documentId] of [[stale, exitedDoc.id], [staleOther, deactivatedDoc.id]] as const) {
      const response = await documentFileResponse({ actor, documentId, version: null, requestUrl: "http://localhost/api" });
      assert.equal(response.status, 404);
    }
    assert.equal((await download(hr.id, exitedDoc.id)).response.status, 200);
  });

  it("ties an acknowledgement to one version and makes a new version pending again", async () => {
    const { hr, employee, other } = await team();
    const policy = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "POLICIES",
      employeeIds: [employee.id, other.id],
      title: "Code of conduct",
      requiresAcknowledgement: true,
      file: file("v1"),
    });
    const before = await listMyDocuments(employee.id);
    assert.equal(before.pendingCount, 1);
    const v1 = before.fromHr[0].current;
    await acknowledgeDocument({ actorId: employee.id, documentId: policy.id, versionId: v1.id });
    await assert.rejects(acknowledgeDocument({ actorId: employee.id, documentId: policy.id, versionId: v1.id }), /already acknowledged/);
    assert.equal((await listMyDocuments(employee.id)).pendingCount, 0);

    const v2 = await addDocumentVersion({ actorId: hr.id, documentId: policy.id, file: file("v2") });
    assert.equal(v2.versionNumber, 2);
    const after = await listMyDocuments(employee.id);
    assert.equal(after.pendingCount, 1);
    assert.equal(after.fromHr[0].current.versionNumber, 2);
    await assert.rejects(
      acknowledgeDocument({ actorId: employee.id, documentId: policy.id, versionId: v1.id }),
      /newer version/,
    );
    const v1Ack = await getDb().documentAcknowledgement.findFirstOrThrow({ where: { userId: employee.id } });
    assert.equal(v1Ack.versionId, v1.id);

    const notices = await getDb().notification.findMany({
      where: { userId: { in: [employee.id, other.id] }, title: "Updated document to acknowledge" },
    });
    assert.equal(notices.length, 2);

    await acknowledgeDocument({ actorId: employee.id, documentId: policy.id, versionId: v2.id });
    const detail = await getDocumentForHr(hr.id, policy.id);
    assert.ok(detail.assignees.find((row) => row.employeeId === employee.id)?.acknowledgedAt);
    assert.equal(detail.assignees.find((row) => row.employeeId === other.id)?.acknowledgedAt, null);
    assert.deepEqual(
      detail.versions.map((row) => [row.versionNumber, row.acknowledgements]),
      [[2, 1], [1, 1]],
    );
    const pending = await listDocumentsForHr(hr.id, { pendingOnly: true });
    assert.equal(pending.find((row) => row.id === policy.id)?.pending, 1);

    const ackAudit = await getDb().auditLog.findMany({ where: { action: "DOCUMENT_ACKNOWLEDGED", entityId: policy.id } });
    assert.deepEqual(ackAudit.map((row) => (row.after as { versionNumber: number }).versionNumber).sort(), [1, 2]);

    await assert.rejects(
      getDb().$executeRaw`UPDATE document_acknowledgements SET "versionId" = ${v2.id} WHERE id = ${v1Ack.id}`,
      /permission denied/,
    );
    await assert.rejects(getDb().$executeRaw`DELETE FROM document_versions WHERE "documentId" = ${policy.id}`, /permission denied/);
  });

  it("gives simultaneous re-uploads different version numbers", async () => {
    const { employee } = await team();
    const doc = await uploadOwnDocument({ actorId: employee.id, categoryCode: "ADDRESS", title: "Rent agreement", file: file("v1") });
    const results = await Promise.all([
      addDocumentVersion({ actorId: employee.id, documentId: doc.id, file: file("a") }),
      addDocumentVersion({ actorId: employee.id, documentId: doc.id, file: file("b") }),
      addDocumentVersion({ actorId: employee.id, documentId: doc.id, file: file("c") }),
    ]);
    assert.deepEqual(results.map((row) => row.versionNumber).sort(), [2, 3, 4]);
    const versions = await getDb().documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { versionNumber: "asc" } });
    assert.deepEqual(versions.map((row) => row.versionNumber), [1, 2, 3, 4]);
  });

  it("assigns open policies to new and newly active employees, and to anyone missing them", async () => {
    const { hr, employee, other, person } = await team();
    const policy = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "POLICIES",
      employeeIds: [employee.id],
      title: "Safety policy",
      requiresAcknowledgement: true,
      file: file("safety"),
    });
    const optional = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "POLICIES",
      employeeIds: [employee.id],
      title: "Canteen menu",
      file: file("menu"),
    });

    const joiner = await person("DN", "New Joiner");
    const preJoiner = await person("DP", "Pre Joiner", { status: "PRE_JOINING" });
    const assigned = async (employeeId: string, documentId: string) =>
      (await getDb().documentAssignment.count({ where: { employeeId, documentId } })) === 1;
    assert.equal(await assigned(joiner.id, policy.id), true);
    assert.equal(await assigned(joiner.id, optional.id), false);
    assert.equal(await assigned(preJoiner.id, policy.id), false);
    const notice = await getDb().notification.findFirst({ where: { userId: joiner.id, title: "Document to acknowledge" } });
    assert.ok(notice);

    await changeEmployeeStatus({ actorId: hr.id, employeeId: preJoiner.id, status: "ACTIVE" });
    assert.equal(await assigned(preJoiner.id, policy.id), true);

    assert.equal(await assigned(other.id, optional.id), false);
    const first = await assignDocumentToMissing({ actorId: hr.id, documentId: optional.id });
    assert.ok(first.added >= 3);
    assert.equal(await assigned(other.id, optional.id), true);
    assert.equal((await assignDocumentToMissing({ actorId: hr.id, documentId: optional.id })).added, 0);
    const assignAudit = await getDb().auditLog.findFirst({ where: { action: "DOCUMENT_ASSIGNED", entityId: optional.id } });
    assert.ok(assignAudit);

    const payslip = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "PAYSLIPS",
      employeeIds: [employee.id],
      title: "Payslip",
      file: file("p"),
    });
    await assert.rejects(assignDocument({ actorId: hr.id, documentId: payslip.id, employeeIds: [other.id] }), /belong to one employee/);
    await assert.rejects(assignDocumentToMissing({ actorId: hr.id, documentId: payslip.id }), /belong to one employee/);
  });

  it("hides removed documents from employees and keeps them for HR", async () => {
    const { hr, employee } = await team();
    const doc = await uploadOwnDocument({ actorId: employee.id, categoryCode: "EDUCATION", title: "Marksheet", file: file("marks") });
    await assert.rejects(removeDocument({ actorId: employee.id, documentId: doc.id, reason: "" }), /Reason/);
    await removeDocument({ actorId: employee.id, documentId: doc.id, reason: "Wrong file" });
    assert.equal((await listMyDocuments(employee.id)).mine.length, 0);
    await assert.rejects(openDocumentFile({ actorId: employee.id, documentId: doc.id }), DocumentAccessError);
    await assert.rejects(addDocumentVersion({ actorId: employee.id, documentId: doc.id, file: file("x") }), DocumentAccessError);

    const detail = await getDocumentForHr(hr.id, doc.id);
    assert.equal(detail.status, "REMOVED");
    assert.equal(detail.removedReason, "Wrong file");
    assert.equal(detail.versions.length, 1);
    assert.equal((await download(hr.id, doc.id, 1)).response.status, 200);
    assert.ok((await listDocumentsForHr(hr.id, { status: "REMOVED" })).some((row) => row.id === doc.id));
    assert.ok(!(await listDocumentsForHr(hr.id, {})).some((row) => row.id === doc.id));
    await assert.rejects(addDocumentVersion({ actorId: hr.id, documentId: doc.id, file: file("x"), onBehalfNote: "re-scan" }), DocumentError);
    assert.equal(await getDb().document.count({ where: { id: doc.id } }), 1);
  });

  it("employees see only the current version; HR sees the history", async () => {
    const { hr, employee } = await team();
    const doc = await uploadOwnDocument({ actorId: employee.id, categoryCode: "IDENTITY", title: "Voter ID", file: file("old") });
    await addDocumentVersion({ actorId: employee.id, documentId: doc.id, file: file("new") });
    await assert.rejects(openDocumentFile({ actorId: employee.id, documentId: doc.id, versionNumber: 1 }), DocumentAccessError);
    assert.equal((await download(employee.id, doc.id)).text, "%PDF-1.4\nnew");
    assert.equal((await download(hr.id, doc.id, 1)).text, "%PDF-1.4\nold");
    await assert.rejects(
      addDocumentVersion({ actorId: hr.id, documentId: doc.id, file: file("hr") }),
      /Uploaded on behalf of note/,
    );
    const hrVersion = await addDocumentVersion({ actorId: hr.id, documentId: doc.id, file: file("hr"), onBehalfNote: "Clearer scan" });
    assert.equal(hrVersion.versionNumber, 3);
  });

  it("audits uploads, versions, removals, and views of sensitive categories only", async () => {
    const { hr, employee } = await team();
    const own = await uploadOwnDocument({ actorId: employee.id, categoryCode: "IDENTITY", title: "Licence", file: file("l") });
    await addDocumentVersion({ actorId: employee.id, documentId: own.id, file: file("l2") });
    await download(employee.id, own.id);
    await download(hr.id, own.id);
    await removeDocument({ actorId: hr.id, documentId: own.id, reason: "Duplicate upload" });
    const policy = await uploadHrDocument({
      actorId: hr.id,
      categoryCode: "POLICIES",
      employeeIds: [employee.id],
      title: "Travel policy",
      file: file("travel"),
    });
    await download(employee.id, policy.id);

    const actions = async (entityId: string) =>
      (await getDb().auditLog.findMany({ where: { entityId, entityType: "Document" }, orderBy: { timestamp: "asc" } })).map(
        (row) => row.action,
      );
    assert.deepEqual(await actions(own.id), [
      "DOCUMENT_UPLOADED",
      "DOCUMENT_VERSION_ADDED",
      "DOCUMENT_VIEWED",
      "DOCUMENT_VIEWED",
      "DOCUMENT_REMOVED",
    ]);
    assert.deepEqual(await actions(policy.id), ["DOCUMENT_UPLOADED"]);

    const hrNotice = await getDb().notification.findFirst({ where: { userId: hr.id, href: `/documents/${own.id}` } });
    assert.ok(hrNotice, "HR is told about an employee upload");
  });
});

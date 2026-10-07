"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  documentFailure,
  readUpload,
  refreshDocuments,
  text,
  type DocumentActionState,
} from "@/lib/document-actions";
import { readRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/services/current-user";
import {
  addDocumentVersion,
  assignDocument,
  assignDocumentToMissing,
  removeDocument,
  updateDocumentDetails,
  uploadHrDocument,
} from "@/lib/services/documents";

function employeeIds(formData: FormData): string[] {
  return formData.getAll("employeeIds").map(String);
}

export async function uploadHrDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  let id: string;
  try {
    const user = await requireUser();
    const result = await uploadHrDocument({
      actorId: user.id,
      categoryCode: text(formData, "categoryCode"),
      employeeIds: employeeIds(formData),
      title: text(formData, "title"),
      description: text(formData, "description"),
      visibility: text(formData, "visibility"),
      requiresAcknowledgement: formData.get("requiresAcknowledgement") === "on",
      expiresOn: text(formData, "expiresOn"),
      onBehalfNote: text(formData, "onBehalfNote"),
      file: await readUpload(formData),
      meta: readRequestMeta(await headers()),
    });
    id = result.id;
    refreshDocuments(id);
  } catch (error) {
    return documentFailure(error);
  }
  redirect(`/documents/${id}`);
}

export async function addHrVersionAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    const documentId = text(formData, "documentId");
    const result = await addDocumentVersion({
      actorId: user.id,
      documentId,
      onBehalfNote: text(formData, "onBehalfNote"),
      file: await readUpload(formData),
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments(documentId);
    return { ok: true, message: `Version ${result.versionNumber} uploaded.` };
  } catch (error) {
    return documentFailure(error);
  }
}

export async function updateDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    const documentId = text(formData, "documentId");
    await updateDocumentDetails({
      actorId: user.id,
      documentId,
      title: text(formData, "title"),
      description: text(formData, "description"),
      visibility: text(formData, "visibility"),
      requiresAcknowledgement: formData.get("requiresAcknowledgement") === "on",
      expiresOn: text(formData, "expiresOn"),
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments(documentId);
    return { ok: true };
  } catch (error) {
    return documentFailure(error);
  }
}

export async function assignDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    const documentId = text(formData, "documentId");
    const { added } = await assignDocument({
      actorId: user.id,
      documentId,
      employeeIds: employeeIds(formData),
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments(documentId);
    return { ok: true, message: added === 0 ? "Everyone chosen already has it." : `Assigned to ${added} more.` };
  } catch (error) {
    return documentFailure(error);
  }
}

export async function assignMissingAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    const documentId = text(formData, "documentId");
    const { added } = await assignDocumentToMissing({
      actorId: user.id,
      documentId,
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments(documentId);
    return { ok: true, message: added === 0 ? "Every active employee already has it." : `Assigned to ${added} more.` };
  } catch (error) {
    return documentFailure(error);
  }
}

export async function removeHrDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    const documentId = text(formData, "documentId");
    await removeDocument({
      actorId: user.id,
      documentId,
      reason: text(formData, "reason"),
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments(documentId);
    return { ok: true, message: "Removed. HR can still see it." };
  } catch (error) {
    return documentFailure(error);
  }
}

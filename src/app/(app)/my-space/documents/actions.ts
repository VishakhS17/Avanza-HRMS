"use server";

import { headers } from "next/headers";
import {
  documentFailure,
  readUpload,
  refreshDocuments,
  text,
  type DocumentActionState,
} from "@/lib/document-actions";
import { readRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/services/current-user";
import { acknowledgeDocument, addDocumentVersion, removeDocument, uploadOwnDocument } from "@/lib/services/documents";

export async function uploadOwnDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    await uploadOwnDocument({
      actorId: user.id,
      categoryCode: text(formData, "categoryCode"),
      title: text(formData, "title"),
      description: text(formData, "description"),
      file: await readUpload(formData),
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments();
    return { ok: true, message: "Uploaded." };
  } catch (error) {
    return documentFailure(error);
  }
}

export async function addOwnVersionAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    const documentId = text(formData, "documentId");
    const result = await addDocumentVersion({
      actorId: user.id,
      documentId,
      file: await readUpload(formData),
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments(documentId);
    return { ok: true, message: `Version ${result.versionNumber} uploaded.` };
  } catch (error) {
    return documentFailure(error);
  }
}

export async function removeOwnDocumentAction(
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
    return { ok: true, message: "Removed." };
  } catch (error) {
    return documentFailure(error);
  }
}

export async function acknowledgeDocumentAction(
  _previous: DocumentActionState,
  formData: FormData,
): Promise<DocumentActionState> {
  try {
    const user = await requireUser();
    const documentId = text(formData, "documentId");
    await acknowledgeDocument({
      actorId: user.id,
      documentId,
      versionId: text(formData, "versionId"),
      meta: readRequestMeta(await headers()),
    });
    refreshDocuments(documentId);
    return { ok: true, message: "Acknowledged." };
  } catch (error) {
    return documentFailure(error);
  }
}

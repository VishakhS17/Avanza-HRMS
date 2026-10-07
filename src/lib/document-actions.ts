import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { DocumentAccessError, DocumentError } from "@/lib/services/document-errors";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { StorageConfigError } from "@/lib/storage";
import { MAX_UPLOAD_BYTES, type UploadInput } from "@/lib/storage/files";

export type DocumentActionState = {
  error?: string;
  ok?: boolean;
  message?: string;
};

export function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

/** Reads the uploaded file. The service checks size, type, and name again. */
export async function readUpload(formData: FormData): Promise<UploadInput> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new DocumentError("Choose a file to upload.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new DocumentError("Files must be 4 MB or smaller.");
  }
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export function refreshDocuments(documentId?: string) {
  revalidatePath("/", "layout");
  revalidatePath("/my-space/documents");
  revalidatePath("/documents");
  if (documentId) revalidatePath(`/documents/${documentId}`);
}

export function documentFailure(error: unknown): DocumentActionState {
  unstable_rethrow(error);
  if (error instanceof DocumentError) return { error: error.message };
  if (error instanceof DocumentAccessError || error instanceof EmployeeAccessError) {
    return { error: "That document is not available." };
  }
  if (error instanceof StorageConfigError) {
    console.error(error);
    return { error: "Document storage is not configured. Ask the administrator." };
  }
  console.error(error);
  return { error: "Could not save that document." };
}

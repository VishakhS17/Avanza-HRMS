/** Upload limits and file checks shared by the document service and the storage adapters. */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const ALLOWED_TYPES = [
  { contentType: "application/pdf", extensions: [".pdf"], label: "PDF" },
  { contentType: "image/png", extensions: [".png"], label: "PNG" },
  { contentType: "image/jpeg", extensions: [".jpg", ".jpeg"], label: "JPEG" },
] as const;

export type AllowedContentType = (typeof ALLOWED_TYPES)[number]["contentType"];

export const UPLOAD_ACCEPT = ALLOWED_TYPES.flatMap((type) => [type.contentType, ...type.extensions]).join(",");

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

export type UploadInput = {
  name: string;
  /** MIME type the browser sent. Checked against the file's first bytes, never trusted alone. */
  type: string;
  bytes: Uint8Array;
};

export type ValidatedFile = {
  fileName: string;
  contentType: AllowedContentType;
  bytes: Uint8Array;
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/** Detects the type from magic bytes. Returns null for anything that is not PDF, PNG, or JPEG. */
export function detectContentType(bytes: Uint8Array): AllowedContentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

/** File name safe to store and show: no path, no control characters, at most 120 characters. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["<>|:*?]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!cleaned) return "document";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 6 ? cleaned.slice(dot) : "";
  return `${cleaned.slice(0, 120 - extension.length)}${extension}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function validateUpload(file: UploadInput): ValidatedFile {
  if (file.bytes.byteLength === 0) {
    throw new FileValidationError("Choose a file to upload.");
  }
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new FileValidationError("Files must be 4 MB or smaller.");
  }
  const detected = detectContentType(file.bytes);
  const allowed = ALLOWED_TYPES.find((type) => type.contentType === detected);
  if (!detected || !allowed) {
    throw new FileValidationError("Upload a PDF, PNG, or JPEG file.");
  }
  const fileName = sanitizeFileName(file.name);
  if (!(allowed.extensions as readonly string[]).includes(extensionOf(fileName))) {
    throw new FileValidationError(`This file is a ${allowed.label}. Its name must end in ${allowed.extensions.join(" or ")}.`);
  }
  const declared = file.type.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== detected) {
    throw new FileValidationError("The file type does not match its contents.");
  }
  return { fileName, contentType: detected, bytes: file.bytes };
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Always an attachment, so the browser saves the file instead of rendering it on our origin. */
export function contentDisposition(fileName: string): string {
  const clean = sanitizeFileName(fileName);
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(clean)}`;
}

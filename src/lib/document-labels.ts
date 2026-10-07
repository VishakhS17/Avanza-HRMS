import type { DocumentVisibility } from "@/generated/prisma/client";

const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  EMPLOYEE_ONLY: "Employee only",
  HR_ONLY: "HR only",
  EMPLOYEE_AND_HR: "Employee and HR",
};

export const VISIBILITY_OPTIONS = (Object.keys(VISIBILITY_LABELS) as DocumentVisibility[]).map((value) => ({
  value,
  label: VISIBILITY_LABELS[value],
}));

export function visibilityLabel(value: DocumentVisibility): string {
  return VISIBILITY_LABELS[value];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fileHref(documentId: string, versionNumber?: number): string {
  return `/api/documents/${documentId}/file${versionNumber ? `?version=${versionNumber}` : ""}`;
}

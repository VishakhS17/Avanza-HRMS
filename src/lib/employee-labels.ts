import type { EmployeeStatus, EmploymentType, Gender } from "@/generated/prisma/client";

export const SENSITIVE_FIELDS = [
  "bankAccountName",
  "bankName",
  "bankAccountNumber",
  "bankIfsc",
  "pan",
  "governmentId",
] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

export const EMPLOYEE_STATUS_OPTIONS: { value: EmployeeStatus; label: string }[] = [
  { value: "PRE_JOINING", label: "Pre-joining" },
  { value: "ACTIVE", label: "Active" },
  { value: "NOTICE", label: "Notice" },
  { value: "EXITED", label: "Exited" },
];

export const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: "FULL_TIME", label: "Full time" },
  { value: "PART_TIME", label: "Part time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERN", label: "Intern" },
];

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "OTHER", label: "Other" },
  { value: "PREFER_NOT_TO_SAY", label: "Prefer not to say" },
];

export function employeeStatusLabel(status: EmployeeStatus): string {
  return EMPLOYEE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export function employeeStatusTone(
  status: EmployeeStatus,
): "success" | "warning" | "info" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "NOTICE") return "warning";
  if (status === "PRE_JOINING") return "info";
  return "neutral";
}

export function employmentTypeLabel(value: EmploymentType): string {
  return EMPLOYMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function genderLabel(value: Gender | null): string {
  if (!value) return "—";
  return GENDER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

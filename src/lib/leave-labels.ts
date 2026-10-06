import type { WeekdayName } from "@/lib/leave-dates";
import { weekdayLabel } from "@/lib/leave-dates";

export function leaveStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    case "CANCELLATION_PENDING":
      return "Cancellation pending";
    default:
      return status;
  }
}

export function leaveStatusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "APPROVED") return "success";
  if (status === "PENDING" || status === "CANCELLATION_PENDING") return "warning";
  return "neutral";
}

export function sessionLabel(session: string | null): string {
  if (session === "FIRST") return "First half";
  if (session === "SECOND") return "Second half";
  return "Full day";
}

export function ledgerEntryLabel(entryType: string): string {
  switch (entryType) {
    case "ACCRUAL":
      return "Accrual";
    case "DEDUCTION":
      return "Deduction";
    case "HOLD":
      return "Hold";
    case "RELEASE":
      return "Release";
    case "CARRY_FORWARD":
      return "Carry forward";
    case "ADJUSTMENT":
      return "Adjustment";
    case "REVERSAL":
      return "Reversal";
    default:
      return entryType;
  }
}

export function weeklyOffLabel(days: readonly WeekdayName[]): string {
  if (days.length === 0) return "No weekly off";
  return days.map((day) => weekdayLabel(day)).join(", ");
}

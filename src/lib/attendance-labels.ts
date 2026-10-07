export type AttendanceTone = "success" | "warning" | "info" | "neutral" | "danger";

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Present",
  WFH: "Work from home",
  HALF_DAY: "Half day",
  ABSENT: "Absent",
  INCOMPLETE: "Incomplete",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
};

const FLAG_LABELS: Record<string, string> = {
  LATE: "Late",
  EARLY_EXIT: "Early exit",
  INCOMPLETE: "Missing punch",
};

export function attendanceStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function attendanceFlagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag;
}

/** Green present, amber half or incomplete, blue WFH or leave, slate off days, dark red absent. */
export function attendanceStatusTone(status: string | null): AttendanceTone {
  switch (status) {
    case "PRESENT":
      return "success";
    case "HALF_DAY":
    case "INCOMPLETE":
      return "warning";
    case "WFH":
    case "ON_LEAVE":
      return "info";
    case "ABSENT":
      return "danger";
    default:
      return "neutral";
  }
}

export function regularizationStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function workedLabel(minutes: number): string {
  if (minutes <= 0) return "—";
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

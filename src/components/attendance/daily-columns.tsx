import type { DataTableColumn } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  attendanceFlagLabel,
  attendanceStatusLabel,
  attendanceStatusTone,
  workedLabel,
} from "@/lib/attendance-labels";
import type { DailyAttendanceRow } from "@/lib/services/attendance";

export function dailyColumns(): DataTableColumn<DailyAttendanceRow>[] {
  return [
    {
      id: "name",
      header: "Employee",
      cell: (row) => (
        <span>
          <span className="block font-medium text-foreground">{row.name}</span>
          <span className="block text-xs text-muted-foreground">
            {row.employeeCode} · {row.department} · {row.location}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          {row.status ? (
            <StatusBadge status={attendanceStatusTone(row.status)}>{attendanceStatusLabel(row.status)}</StatusBadge>
          ) : (
            <StatusBadge status="neutral">{row.firstIn ? "In progress" : "Not recorded"}</StatusBadge>
          )}
          {row.flags.map((flag) => (
            <StatusBadge key={flag} status="warning">
              {attendanceFlagLabel(flag)}
            </StatusBadge>
          ))}
          {row.regularized ? <StatusBadge status="info">Regularized</StatusBadge> : null}
          {row.overridden ? <StatusBadge status="info">Set by HR</StatusBadge> : null}
          {row.provisional && row.status ? <span className="text-xs text-muted-foreground">not finalized</span> : null}
        </span>
      ),
    },
    { id: "in", header: "In", cell: (row) => row.firstIn ?? "—" },
    { id: "out", header: "Out", cell: (row) => row.lastOut ?? "—" },
    { id: "worked", header: "Worked", cell: (row) => workedLabel(row.workedMinutes) },
    {
      id: "mode",
      header: "Mode",
      cell: (row) => (row.mode === "WFH" ? "WFH" : row.mode === "OFFICE" ? "Office" : "—"),
    },
  ];
}

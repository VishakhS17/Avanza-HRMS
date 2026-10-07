import type { Metadata } from "next";
import Link from "next/link";
import { OverrideDialog } from "@/app/(app)/attendance/override-dialog";
import { dailyColumns } from "@/components/attendance/daily-columns";
import { DateNav } from "@/components/attendance/month-nav";
import { DataTable } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { attendanceStatusLabel } from "@/lib/attendance-labels";
import { ATTENDANCE_STATUSES, listDailyAttendance } from "@/lib/services/attendance";
import { requireCan } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Attendance admin",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function AttendanceAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("attendance.manage");
  const params = await searchParams;
  const view = await listDailyAttendance(user.id, {
    date: first(params.date),
    locationId: first(params.locationId),
    departmentId: first(params.departmentId),
    status: first(params.status),
  });
  const filterQuery = new URLSearchParams(
    Object.entries(view.filters).filter(([, value]) => value) as [string, string][],
  ).toString();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description="Everyone's attendance for one day. Overrides need a reason and are audited."
        actions={<DateNav basePath="/attendance" date={view.date} query={filterQuery} />}
      />
      <form className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-5 sm:items-end">
        <FormField label="Date" htmlFor="att-date">
          <Input name="date" type="date" defaultValue={view.date} />
        </FormField>
        <FormField label="Location" htmlFor="att-location">
          <NativeSelect name="locationId" defaultValue={view.filters.locationId}>
            <option value="">All</option>
            {view.locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Department" htmlFor="att-department">
          <NativeSelect name="departmentId" defaultValue={view.filters.departmentId}>
            <option value="">All</option>
            {view.departments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Status" htmlFor="att-status">
          <NativeSelect name="status" defaultValue={view.filters.status}>
            <option value="">All</option>
            {ATTENDANCE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {attendanceStatusLabel(status)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-foreground">{view.date}</p>
        {view.locked ? <StatusBadge status="neutral">Locked month · HR edits only</StatusBadge> : null}
      </div>
      <DataTable
        columns={[
          ...dailyColumns(),
          {
            id: "actions",
            header: "",
            cell: (row) => (
              <span className="flex items-center gap-2">
                <Link
                  href={`/attendance/${row.employeeId}?month=${view.date.slice(0, 7)}`}
                  className="text-sm text-secondary hover:underline"
                >
                  Month
                </Link>
                {row.employeeId !== user.id ? (
                  <OverrideDialog
                    employeeId={row.employeeId}
                    name={row.name}
                    workDate={view.date}
                    status={row.status}
                    statuses={ATTENDANCE_STATUSES}
                  />
                ) : null}
              </span>
            ),
          },
        ]}
        data={view.rows}
        getRowKey={(row) => row.employeeId}
        emptyTitle="No one to show"
        emptyDescription="No employees were active on this date with these filters."
      />
    </div>
  );
}

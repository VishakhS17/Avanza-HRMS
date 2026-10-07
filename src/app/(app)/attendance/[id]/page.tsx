import type { Metadata } from "next";
import { AttendanceCalendar } from "@/components/attendance/attendance-calendar";
import { MonthNav } from "@/components/attendance/month-nav";
import { PageHeader } from "@/components/shared/page-header";
import { redirectEmployeeAccess } from "@/lib/employee-page";
import { monthLabel } from "@/lib/leave-dates";
import { getEmployeeAttendanceMonth } from "@/lib/services/attendance";
import { requireCan } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Employee attendance",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function EmployeeAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireCan("attendance.manage");

  let view;
  try {
    view = await getEmployeeAttendanceMonth(user.id, id, first(query.month));
  } catch (error) {
    redirectEmployeeAccess(error);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${view.employee.name} · attendance`}
        description={`${view.employee.employeeCode}. Use the daily view to override a day.`}
        actions={<MonthNav basePath={`/attendance/${id}`} month={view.month} />}
      />
      <p className="text-sm font-medium text-foreground">{monthLabel(view.month)}</p>
      <AttendanceCalendar days={view.days} />
    </div>
  );
}

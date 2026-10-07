import type { Metadata } from "next";
import { AttendanceCalendar } from "@/components/attendance/attendance-calendar";
import { MonthNav } from "@/components/attendance/month-nav";
import { PageHeader } from "@/components/shared/page-header";
import { monthLabel } from "@/lib/leave-dates";
import { getMyAttendanceMonth } from "@/lib/services/attendance";
import { isOvernight, LOCK_CUTOFF_DAY, REGULARIZATION_WINDOW_DAYS } from "@/lib/services/attendance-rules";
import { requireUser } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Attendance",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const view = await getMyAttendanceMonth(user.id, first(params.month));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description={`Your month at a glance. Select a day for punches and to regularize it within ${REGULARIZATION_WINDOW_DAYS} days. A month locks after day ${LOCK_CUTOFF_DAY} of the next month.`}
        actions={<MonthNav basePath="/my-space/attendance" month={view.month} />}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{monthLabel(view.month)}</p>
        {view.shift ? (
          <p className="text-sm text-muted-foreground">
            {view.shift.location} · {view.shift.name} {view.shift.startTime}–{view.shift.endTime} · {view.shift.graceMinutes} min grace
          </p>
        ) : null}
      </div>
      <AttendanceCalendar
        days={view.days}
        allowRegularize
        overnight={view.shift ? isOvernight(view.shift) : false}
      />
    </div>
  );
}

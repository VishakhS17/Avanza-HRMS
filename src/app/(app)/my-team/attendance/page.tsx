import type { Metadata } from "next";
import Link from "next/link";
import { dailyColumns } from "@/components/attendance/daily-columns";
import { DateNav } from "@/components/attendance/month-nav";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { listTeamAttendance } from "@/lib/services/attendance";
import { requireCan } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Team attendance",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function TeamAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("team.view");
  const params = await searchParams;
  const { date, rows } = await listTeamAttendance(user.id, first(params.date));
  const month = date.slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team attendance"
        description="Attendance for your direct reports. Select a person for their month."
        actions={<DateNav basePath="/my-team/attendance" date={date} />}
      />
      <p className="text-sm font-medium text-foreground">{date}</p>
      <DataTable
        columns={[
          ...dailyColumns(),
          {
            id: "month",
            header: "",
            cell: (row) => (
              <Link
                href={`/my-team/attendance/${row.employeeId}?month=${month}`}
                className="text-sm text-secondary hover:underline"
              >
                Month
              </Link>
            ),
          },
        ]}
        data={rows}
        getRowKey={(row) => row.employeeId}
        emptyTitle="No direct reports"
        emptyDescription="When someone reports to you, their attendance shows here."
      />
    </div>
  );
}

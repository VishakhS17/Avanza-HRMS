import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { employeeStatusLabel, employeeStatusTone } from "@/lib/employee-labels";
import { requireCan } from "@/lib/services/current-user";
import { listTeam } from "@/lib/services/employees";

export const metadata: Metadata = {
  title: "My Team",
};

export default async function MyTeamPage() {
  const user = await requireCan("team.view");
  const reports = await listTeam(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My Team"
        description="People who report to you right now."
        actions={
          <Button variant="secondary" asChild>
            <Link href="/my-team/leave">Team leave calendar</Link>
          </Button>
        }
      />
      {reports.length === 0 ? (
        <EmptyState title="No direct reports" description="When someone reports to you, they show up here." />
      ) : (
        <div className="grid gap-3">
          {reports.map((report) => (
            <Link
              key={report.id}
              href={`/my-team/${report.id}`}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{report.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {report.job?.designation.name ?? "—"} · {report.job?.department.name ?? "—"}
                  </p>
                </div>
                <StatusBadge status={employeeStatusTone(report.status)}>
                  {employeeStatusLabel(report.status)}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-foreground">{report.workEmail}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

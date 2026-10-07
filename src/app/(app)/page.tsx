import type { Metadata } from "next";
import Link from "next/link";
import { PunchCard } from "@/components/attendance/punch-card";
import { DashboardWidget } from "@/components/dashboard/dashboard-widget";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import type { EmployeeStatus } from "@/generated/prisma/client";
import { attendanceStatusLabel } from "@/lib/attendance-labels";
import { employeeStatusLabel } from "@/lib/employee-labels";
import { formatDays } from "@/lib/leave-dates";
import { leaveStatusLabel, leaveStatusTone } from "@/lib/leave-labels";
import { loadHomeDashboard } from "@/lib/services/dashboard";
import { requireUser } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const user = await requireUser();
  const dash = await loadHomeDashboard(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Home" description="What needs your attention today." />
      <PunchCard status={dash.punch} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardWidget title="Leave balances" href="/my-space/leave" hrefLabel="Open leave">
          {dash.leaveBalances.length === 0 ? (
            <p className="text-sm text-muted-foreground">Leave types appear here once the catalogue is seeded.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-3">
              {dash.leaveBalances.map((row) => (
                <li key={row.leaveTypeId}>
                  <p className="text-sm text-muted-foreground">{row.name}</p>
                  <p className="text-xl font-semibold text-foreground">{formatDays(row.balance)}</p>
                </li>
              ))}
            </ul>
          )}
        </DashboardWidget>
        <DashboardWidget
          title="Your requests"
          href="/my-space/leave"
          hrefLabel="Open leave"
          empty={dash.pendingRequests.length === 0 ? "No pending leave requests." : undefined}
        >
          {dash.pendingRequests.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {dash.pendingRequests.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-foreground">
                    {row.leaveType} · {row.startDate} to {row.endDate}
                  </span>
                  <StatusBadge status={leaveStatusTone(row.status)}>{leaveStatusLabel(row.status)}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : null}
        </DashboardWidget>
        <DashboardWidget
          title="Upcoming holidays"
          href="/my-space/holidays"
          hrefLabel="Open holidays"
          empty={dash.holidays.length === 0 ? "No upcoming holidays for your location." : undefined}
        >
          {dash.holidays.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {dash.holidays.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">{row.name}</span>
                  <span className="text-muted-foreground">{row.date}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </DashboardWidget>
        <DashboardWidget
          title="Documents to acknowledge"
          href="/my-space/documents"
          hrefLabel="Open documents"
          empty={dash.pendingDocuments.length === 0 ? "Nothing waiting for acknowledgement." : undefined}
        >
          {dash.pendingDocuments.length > 0 ? (
            <ul className="flex flex-col gap-2 text-sm">
              {dash.pendingDocuments.map((row) => (
                <li key={row.id}>
                  <Link href="/my-space/documents" className="font-medium text-secondary hover:underline">
                    {row.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </DashboardWidget>
      </div>
      {dash.manager ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">Your team</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <DashboardWidget title="Pending approvals" href="/inbox" hrefLabel="Open inbox">
              <p className="text-2xl font-semibold text-foreground">{dash.manager.pendingApprovals}</p>
              <p className="text-sm text-muted-foreground">
                {dash.manager.pendingApprovals === 1 ? "request waiting on you" : "requests waiting on you"}
              </p>
            </DashboardWidget>
            <DashboardWidget
              title="Who is out"
              href="/my-team/leave"
              hrefLabel="Team leave"
              empty={
                dash.manager.outToday.length === 0 && dash.manager.outThisWeek.length === 0
                  ? "Nobody on your team is on leave today or this week."
                  : undefined
              }
            >
              {dash.manager.outToday.length > 0 || dash.manager.outThisWeek.length > 0 ? (
                <div className="flex flex-col gap-3 text-sm">
                  <div>
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Today</p>
                    {dash.manager.outToday.length === 0 ? (
                      <p className="mt-1 text-muted-foreground">Nobody out today.</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1">
                        {dash.manager.outToday.map((row) => (
                          <li key={`${row.employeeId}-${row.startDate}`}>
                            <Link href={`/my-team/${row.employeeId}`} className="font-medium text-secondary hover:underline">
                              {row.name}
                            </Link>
                            <span className="text-muted-foreground">
                              {" "}
                              · {row.leaveType} · {row.startDate}
                              {row.endDate !== row.startDate ? ` to ${row.endDate}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">This week</p>
                    {dash.manager.outThisWeek.length === 0 ? (
                      <p className="mt-1 text-muted-foreground">Nobody out this week.</p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1">
                        {dash.manager.outThisWeek.map((row) => (
                          <li key={`${row.employeeId}-${row.startDate}-week`}>
                            <Link href={`/my-team/${row.employeeId}`} className="font-medium text-secondary hover:underline">
                              {row.name}
                            </Link>
                            <span className="text-muted-foreground">
                              {" "}
                              · {row.leaveType} · {row.startDate}
                              {row.endDate !== row.startDate ? ` to ${row.endDate}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </DashboardWidget>
            <DashboardWidget
              title="Team attendance today"
              href="/my-team/attendance"
              hrefLabel="Team attendance"
              empty={dash.manager.attendanceToday.length === 0 ? "No team attendance to show." : undefined}
            >
              {dash.manager.attendanceToday.length > 0 ? (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {dash.manager.attendanceToday.map((row) => (
                    <li key={row.status} className="rounded-lg bg-muted px-2 py-1 text-foreground">
                      {row.status === "Not recorded" ? "Not recorded" : attendanceStatusLabel(row.status)} · {row.count}
                    </li>
                  ))}
                </ul>
              ) : null}
            </DashboardWidget>
            <DashboardWidget
              title="Missing punches"
              href="/my-team/attendance"
              hrefLabel="Team attendance"
              empty={dash.manager.missingPunches.length === 0 ? "No missing punches on your team today." : undefined}
            >
              {dash.manager.missingPunches.length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {dash.manager.missingPunches.map((row) => (
                    <li key={row.employeeId}>
                      <Link
                        href={`/my-team/attendance/${row.employeeId}`}
                        className="font-medium text-secondary hover:underline"
                      >
                        {row.name}
                      </Link>
                      <span className="text-muted-foreground">
                        {" "}
                        · {row.status ? attendanceStatusLabel(row.status) : "No punch"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </DashboardWidget>
          </div>
        </div>
      ) : null}
      {dash.hr ? (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-foreground">People and attendance</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <DashboardWidget title="Headcount" href="/people" hrefLabel="Open people">
              <ul className="flex flex-wrap gap-2 text-sm">
                {dash.hr.headcount.map((row) => (
                  <li key={row.status} className="rounded-lg bg-muted px-2 py-1 text-foreground">
                    {employeeStatusLabel(row.status as EmployeeStatus)} · {row.count}
                  </li>
                ))}
              </ul>
            </DashboardWidget>
            <DashboardWidget title="Joiners and exits this month" href="/people" hrefLabel="Open people">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Joiners</p>
                  {dash.hr.joinersThisMonth.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">None this month.</p>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-1">
                      {dash.hr.joinersThisMonth.map((row) => (
                        <li key={row.id}>
                          <Link href={`/people/${row.id}`} className="font-medium text-secondary hover:underline">
                            {row.name}
                          </Link>
                          <span className="text-muted-foreground"> · {row.joiningDate}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Exits</p>
                  {dash.hr.exitsThisMonth.length === 0 ? (
                    <p className="mt-1 text-muted-foreground">None this month.</p>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-1">
                      {dash.hr.exitsThisMonth.map((row) => (
                        <li key={row.id}>
                          <Link
                            href={`/people/${row.id}`}
                            className="font-medium text-secondary hover:underline"
                          >
                            {row.name}
                          </Link>
                          <span className="text-muted-foreground"> · {row.exitDate}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </DashboardWidget>
            <DashboardWidget
              title="Today's attendance"
              href="/attendance"
              hrefLabel="Daily attendance"
              empty={dash.hr.attendanceToday.length === 0 ? "No attendance to summarise yet." : undefined}
            >
              {dash.hr.attendanceToday.length > 0 ? (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {dash.hr.attendanceToday.map((row) => (
                    <li key={row.status} className="rounded-lg bg-muted px-2 py-1 text-foreground">
                      {row.status === "Not recorded" ? "Not recorded" : attendanceStatusLabel(row.status)} · {row.count}
                    </li>
                  ))}
                </ul>
              ) : null}
            </DashboardWidget>
            <DashboardWidget title="Pending HR actions" href="/inbox" hrefLabel="Open inbox">
              <ul className="flex flex-col gap-2 text-sm">
                {dash.hr.pendingActions.map((row) => (
                  <li key={row.href} className="flex items-center justify-between gap-2">
                    <Link href={row.href} className="font-medium text-secondary hover:underline">
                      {row.label}
                    </Link>
                    <span className="text-foreground">{row.count}</span>
                  </li>
                ))}
              </ul>
            </DashboardWidget>
          </div>
        </div>
      ) : null}
    </div>
  );
}

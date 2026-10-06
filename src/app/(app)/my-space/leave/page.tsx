import type { Metadata } from "next";
import { CancelLeaveForm, LeaveApplyForm } from "@/app/(app)/my-space/leave/forms";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDays } from "@/lib/leave-dates";
import { leaveStatusLabel, leaveStatusTone, sessionLabel } from "@/lib/leave-labels";
import { requireUser } from "@/lib/services/current-user";
import { listMyLeave } from "@/lib/services/leave";

export const metadata: Metadata = {
  title: "Leave",
};

export default async function LeavePage() {
  const user = await requireUser();
  const { balances, history } = await listMyLeave(user.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Leave" description="Your balances, a new request, and what you have already asked for." />
      {balances.length === 0 ? (
        <EmptyState
          title="Leave is not set up"
          description="Ask an administrator to run the database seed so leave types exist."
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((balance) => (
              <article key={balance.leaveTypeId} className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{balance.name}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{formatDays(balance.balance)}</p>
                <p className="text-xs text-muted-foreground">days available</p>
              </article>
            ))}
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-medium text-foreground">Apply</h2>
            <LeaveApplyForm types={balances} />
          </section>
        </>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">History</h2>
        {history.length === 0 ? (
          <EmptyState title="No leave requests" description="Submitted requests stay here, including rejected and cancelled ones." />
        ) : (
          <div className="grid gap-3">
            {history.map((row) => (
              <article key={row.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {row.leaveType} · {row.startDate} to {row.endDate}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {sessionLabel(row.session)} · {formatDays(row.workingDays)} working days
                    </p>
                  </div>
                  <StatusBadge status={leaveStatusTone(row.status)}>{leaveStatusLabel(row.status)}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-foreground">{row.reason}</p>
                {row.comment ? <p className="mt-1 text-sm text-muted-foreground">Comment: {row.comment}</p> : null}
                {row.canCancelDirectly ? <CancelLeaveForm requestId={row.id} label="Cancel" /> : null}
                {row.canRequestCancellation ? (
                  <CancelLeaveForm requestId={row.id} label="Request cancellation" />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

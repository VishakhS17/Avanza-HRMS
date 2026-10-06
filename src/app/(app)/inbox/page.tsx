import type { Metadata } from "next";
import Link from "next/link";
import { DecisionForm } from "@/app/(app)/inbox/decision-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { sessionLabel } from "@/lib/leave-labels";
import { requireUser } from "@/lib/services/current-user";
import { loadInbox, markNotificationsRead } from "@/lib/services/leave";

export const metadata: Metadata = {
  title: "Inbox",
};

export default async function InboxPage() {
  const user = await requireUser();
  const inbox = await loadInbox(user.id);
  await markNotificationsRead(user.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Inbox"
        description="Leave requests waiting on you, and notices about your own requests."
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Pending approvals</h2>
        {inbox.approvals.length === 0 ? (
          <EmptyState title="No pending approvals" description="When someone needs your decision, it shows up here." />
        ) : (
          inbox.approvals.map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{item.requesterName}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.type === "LEAVE_CANCELLATION" ? "Cancellation · " : ""}
                    {item.leaveType} · {item.startDate} to {item.endDate} · {sessionLabel(item.session)} ·{" "}
                    {item.workingDays} days
                  </p>
                </div>
                <StatusBadge status="warning">Pending</StatusBadge>
              </div>
              <p className="mt-3 text-sm text-foreground">{item.reason}</p>
              <div className="mt-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Team overlap</p>
                {item.overlap.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">No one else on this team is off on these dates.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm text-foreground">
                    {item.overlap.map((row) => (
                      <li key={`${row.name}-${row.date}-${row.leaveType}`}>
                        {row.name} · {row.date} · {row.leaveType} · {row.portion} day
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <DecisionForm approvalId={item.id} />
            </article>
          ))
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Notifications</h2>
        {inbox.notifications.length === 0 ? (
          <EmptyState title="No notifications" description="Decisions and new requests are listed here." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {inbox.notifications.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <p className="text-sm font-medium text-foreground">
                  {item.unread ? <span className="mr-2 inline-block size-2 rounded-full bg-primary" aria-hidden="true" /> : null}
                  {item.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                {item.href ? (
                  <Link href={item.href} className="mt-1 inline-block text-sm text-secondary hover:underline">
                    Open
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

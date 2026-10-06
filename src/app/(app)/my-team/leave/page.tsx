import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { daysInMonth, monthLabel, shiftMonth, todayIso, weekdayOf } from "@/lib/leave-dates";
import { leaveStatusLabel, leaveStatusTone } from "@/lib/leave-labels";
import { requireCan } from "@/lib/services/current-user";
import { listTeamLeave } from "@/lib/services/leave";

export const metadata: Metadata = {
  title: "Team leave",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function monthOrCurrent(value: string): string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : todayIso().slice(0, 7);
}

const HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function TeamLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("team.view");
  const params = await searchParams;
  const month = monthOrCurrent(first(params.month));
  const entries = await listTeamLeave(user.id, month);
  const days = daysInMonth(month);
  const leading = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].indexOf(
    weekdayOf(days[0] ?? `${month}-01`),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team leave"
        description="Pending and approved leave for your direct reports."
        actions={
          <div className="flex gap-2">
            <Link
              href={`/my-team/leave?month=${shiftMonth(month, -1)}`}
              className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm text-foreground"
            >
              Previous
            </Link>
            <Link
              href={`/my-team/leave?month=${shiftMonth(month, 1)}`}
              className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm text-foreground"
            >
              Next
            </Link>
          </div>
        }
      />
      <p className="text-sm font-medium text-foreground">{monthLabel(month)}</p>
      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {HEADS.map((head) => (
            <div key={head} className="bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {head}
            </div>
          ))}
          {Array.from({ length: leading }, (_, index) => (
            <div key={`pad-${index}`} className="min-h-24 bg-card" />
          ))}
          {days.map((date) => {
            const people = entries.get(date) ?? [];
            return (
              <div key={date} className="min-h-24 bg-card p-2">
                <p className="text-xs text-muted-foreground">{Number(date.slice(8))}</p>
                <ul className="mt-1 space-y-1">
                  {people.map((person) => (
                    <li key={`${person.employeeId}-${person.leaveType}-${person.portion}`} className="text-xs">
                      <span className="text-foreground">{person.name}</span>
                      <StatusBadge status={leaveStatusTone(person.status)} className="mt-0.5">
                        {person.leaveType} · {leaveStatusLabel(person.status)}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

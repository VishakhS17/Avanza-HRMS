"use client";

import { useActionState, useState } from "react";
import { regularizeAction, type AttendanceActionState } from "@/app/(app)/my-space/attendance/actions";
import { FormField } from "@/components/shared/form-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  attendanceFlagLabel,
  attendanceStatusLabel,
  attendanceStatusTone,
  regularizationStatusLabel,
  workedLabel,
} from "@/lib/attendance-labels";
import type { AttendanceDayView } from "@/lib/services/attendance";

const HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const initialState: AttendanceActionState = {};
const reasonClassName =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function leadingBlanks(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}

function RegularizeForm({ day, overnight }: { day: AttendanceDayView; overnight: boolean }) {
  const [state, action, pending] = useActionState(regularizeAction, initialState);
  if (state.ok) {
    return <p className="text-sm text-secondary">Sent for approval. The day updates once it is approved.</p>;
  }
  const clock = (value: string | null) => (value ? value.slice(0, 5) : "");
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="workDate" value={day.date} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Check-in" htmlFor={`reg-in-${day.date}`}>
          <Input name="inTime" type="time" defaultValue={clock(day.firstIn)} required />
        </FormField>
        <FormField
          label="Check-out"
          htmlFor={`reg-out-${day.date}`}
          hint={overnight ? "A time earlier than check-in means the next morning." : undefined}
        >
          <Input name="outTime" type="time" defaultValue={clock(day.lastOut)} required />
        </FormField>
      </div>
      <FormField label="Reason" htmlFor={`reg-reason-${day.date}`}>
        <textarea name="reason" className={reasonClassName} maxLength={500} required />
      </FormField>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit regularization"}
        </Button>
      </div>
    </form>
  );
}

function DayDetail({ day, allowRegularize, overnight }: { day: AttendanceDayView; allowRegularize: boolean; overnight: boolean }) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="flex flex-wrap gap-2">
        {day.status ? (
          <StatusBadge status={attendanceStatusTone(day.status)}>{attendanceStatusLabel(day.status)}</StatusBadge>
        ) : (
          <StatusBadge status="neutral">{day.isToday ? "Today" : day.isFuture ? "Upcoming" : "No record"}</StatusBadge>
        )}
        {day.flags.map((flag) => (
          <StatusBadge key={flag} status="warning">
            {attendanceFlagLabel(flag)}
          </StatusBadge>
        ))}
        {day.regularized ? <StatusBadge status="info">Regularized</StatusBadge> : null}
        {day.overridden ? <StatusBadge status="info">Set by HR</StatusBadge> : null}
        {day.locked ? <StatusBadge status="neutral">Locked month</StatusBadge> : null}
      </div>
      {day.provisional && day.status ? (
        <p className="text-xs text-muted-foreground">Not finalized yet. The nightly job stores this day.</p>
      ) : null}
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">In</dt>
          <dd className="text-foreground">{day.firstIn ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Out</dt>
          <dd className="text-foreground">{day.lastOut ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Worked</dt>
          <dd className="text-foreground">{workedLabel(day.workedMinutes)}</dd>
        </div>
      </dl>
      {day.holidayName ? <p className="text-sm text-foreground">Holiday: {day.holidayName}</p> : null}
      {day.leaveTypes.length ? <p className="text-sm text-foreground">Leave: {day.leaveTypes.join(", ")}</p> : null}
      {day.overrideReason ? <p className="text-sm text-foreground">HR note: {day.overrideReason}</p> : null}

      <section>
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Punches</h3>
        {day.punches.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No punches.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-foreground">
            {day.punches.map((punch, index) => (
              <li key={`${punch.type}-${index}`}>
                {punch.type === "CHECK_IN" ? "Check-in" : "Check-out"} {punch.time}
                {punch.date !== day.date ? ` (${punch.date})` : ""} · {punch.mode === "WFH" ? "WFH" : "Office"}
                {punch.ipAddress ? ` · ${punch.ipAddress}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {day.regularizations.length ? (
        <section>
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Regularizations</h3>
          <ul className="mt-1 space-y-2 text-sm text-foreground">
            {day.regularizations.map((row) => (
              <li key={row.id}>
                <span className="font-medium">{regularizationStatusLabel(row.status)}</span> · {row.requestedIn} to{" "}
                {row.requestedOut}
                <span className="block text-muted-foreground">{row.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {allowRegularize && day.canRegularize ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Regularize</h3>
          <RegularizeForm key={day.date} day={day} overnight={overnight} />
        </section>
      ) : null}
    </div>
  );
}

export function AttendanceCalendar({
  days,
  allowRegularize = false,
  overnight = false,
}: {
  days: AttendanceDayView[];
  allowRegularize?: boolean;
  overnight?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const day = days.find((item) => item.date === selected) ?? null;
  const leading = days[0] ? leadingBlanks(days[0].date) : 0;

  return (
    <>
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
          {days.map((item) => (
            <button
              key={item.date}
              type="button"
              onClick={() => setSelected(item.date)}
              className={`flex min-h-24 flex-col items-start gap-1 bg-card p-2 text-left hover:bg-muted/60 ${item.isToday ? "ring-2 ring-secondary ring-inset" : ""}`}
            >
              <span className="text-xs text-muted-foreground">{Number(item.date.slice(8))}</span>
              {item.status ? (
                <StatusBadge status={attendanceStatusTone(item.status)}>{attendanceStatusLabel(item.status)}</StatusBadge>
              ) : item.isToday && item.punches.length ? (
                <StatusBadge status="neutral">In progress</StatusBadge>
              ) : null}
              {item.flags.filter((flag) => flag !== "INCOMPLETE").map((flag) => (
                <span key={flag} className="text-xs text-warning">
                  {attendanceFlagLabel(flag)}
                </span>
              ))}
              {item.regularizations.some((row) => row.status === "PENDING") ? (
                <span className="text-xs text-secondary">Regularization pending</span>
              ) : item.canRegularize && allowRegularize ? (
                <span className="text-xs text-primary">Needs regularization</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <Sheet open={day !== null} onOpenChange={(open) => (open ? null : setSelected(null))}>
        <SheetContent className="overflow-y-auto">
          {day ? (
            <>
              <SheetHeader>
                <SheetTitle>{day.date}</SheetTitle>
                <SheetDescription>Attendance details for this work date.</SheetDescription>
              </SheetHeader>
              <DayDetail day={day} allowRegularize={allowRegularize} overnight={overnight} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

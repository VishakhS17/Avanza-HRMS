"use client";

import { useActionState } from "react";
import { punchAction, type AttendanceActionState } from "@/app/(app)/my-space/attendance/actions";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import type { PunchStatus } from "@/lib/services/attendance";

const initialState: AttendanceActionState = {};

export function PunchCard({ status }: { status: PunchStatus }) {
  const [state, action, pending] = useActionState(punchAction, initialState);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-medium text-foreground">Attendance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {status.shift
              ? `${status.shift.name} shift ${status.shift.startTime}–${status.shift.endTime} · work date ${status.workDate}`
              : (status.message ?? "")}
          </p>
        </div>
        {status.canPunch ? (
          <StatusBadge status={status.checkedIn ? "success" : "neutral"}>
            {status.checkedIn ? "Checked in" : "Not checked in"}
          </StatusBadge>
        ) : null}
      </div>
      {status.punches.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm text-foreground">
          {status.punches.map((punch, index) => (
            <li key={`${punch.type}-${index}`} className="rounded-lg bg-muted px-2 py-1">
              {punch.type === "CHECK_IN" ? "In" : "Out"} {punch.time}
              {punch.date !== status.workDate ? ` (${punch.date})` : ""} · {punch.mode === "WFH" ? "WFH" : "Office"}
            </li>
          ))}
        </ul>
      ) : null}
      {status.canPunch ? (
        <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="type" value={status.checkedIn ? "CHECK_OUT" : "CHECK_IN"} />
          {status.checkedIn ? null : (
            <FormField label="Working from" htmlFor="punch-mode">
              <NativeSelect name="mode" defaultValue="OFFICE">
                <option value="OFFICE">Office</option>
                <option value="WFH">Home</option>
              </NativeSelect>
            </FormField>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : status.checkedIn ? "Check out" : "Check in"}
          </Button>
        </form>
      ) : null}
      {state.error ? <p className="mt-2 text-sm text-destructive">{state.error}</p> : null}
      <p className="mt-2 text-xs text-muted-foreground">The server clock records the time. Missed punches are fixed by a regularization.</p>
    </section>
  );
}

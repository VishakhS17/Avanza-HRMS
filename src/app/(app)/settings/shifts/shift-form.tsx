"use client";

import { useActionState } from "react";
import { updateShiftAction, type AttendanceAdminState } from "@/app/(app)/attendance/actions";
import { FormField } from "@/components/shared/form-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ShiftView } from "@/lib/services/attendance";

const initialState: AttendanceAdminState = {};

export function ShiftForm({ shift }: { shift: ShiftView }) {
  const [state, action, pending] = useActionState(updateShiftAction, initialState);
  const id = (field: string) => `shift-${shift.locationId}-${field}`;

  return (
    <form action={action} className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="locationId" value={shift.locationId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium text-foreground">{shift.locationName}</h2>
        <span className="flex gap-2">
          {shift.overnight ? <StatusBadge status="info">Night shift</StatusBadge> : null}
          {shift.isActive ? null : <StatusBadge status="neutral">Inactive location</StatusBadge>}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Shift name" htmlFor={id("name")}>
          <Input name="name" defaultValue={shift.name} required maxLength={40} />
        </FormField>
        <FormField label="Start" htmlFor={id("start")}>
          <Input name="startTime" type="time" defaultValue={shift.startTime} required />
        </FormField>
        <FormField label="End" htmlFor={id("end")} hint="Earlier than start means it ends the next morning.">
          <Input name="endTime" type="time" defaultValue={shift.endTime} required />
        </FormField>
        <FormField label="Grace minutes" htmlFor={id("grace")} hint="Check-in after start plus this is late.">
          <Input name="graceMinutes" type="number" min={0} max={240} defaultValue={shift.graceMinutes} required />
        </FormField>
        <FormField label="Half-day hours" htmlFor={id("half")}>
          <Input name="halfDayHours" inputMode="decimal" defaultValue={shift.halfDayHours} required />
        </FormField>
        <FormField label="Full-day hours" htmlFor={id("full")}>
          <Input name="fullDayHours" inputMode="decimal" defaultValue={shift.fullDayHours} required />
        </FormField>
        <FormField
          label="Early check-in minutes"
          htmlFor={id("early")}
          hint="A check-in this long before start counts for that shift."
        >
          <Input
            name="earlyCheckInMinutes"
            type="number"
            min={0}
            max={720}
            defaultValue={shift.earlyCheckInMinutes}
            required
          />
        </FormField>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-secondary">Saved. Applies to days computed from now on.</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save shift"}
        </Button>
      </div>
    </form>
  );
}

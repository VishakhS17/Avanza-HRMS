"use client";

import { useActionState, useState } from "react";
import { overrideAttendanceAction, type AttendanceAdminState } from "@/app/(app)/attendance/actions";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { attendanceStatusLabel } from "@/lib/attendance-labels";

const initialState: AttendanceAdminState = {};
const reasonClassName =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function OverrideForm({
  employeeId,
  workDate,
  status,
  statuses,
}: {
  employeeId: string;
  workDate: string;
  status: string | null;
  statuses: readonly string[];
}) {
  const [state, action, pending] = useActionState(overrideAttendanceAction, initialState);
  if (state.ok) return <p className="text-sm text-secondary">Saved. The day is now set by HR.</p>;
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="workDate" value={workDate} />
      <FormField label="Status" htmlFor={`ov-status-${employeeId}`}>
        <NativeSelect name="status" defaultValue={status ?? "PRESENT"}>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {attendanceStatusLabel(value)}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Check-in" htmlFor={`ov-in-${employeeId}`} hint="Optional">
          <Input name="inTime" type="time" />
        </FormField>
        <FormField label="Check-out" htmlFor={`ov-out-${employeeId}`} hint="Optional">
          <Input name="outTime" type="time" />
        </FormField>
      </div>
      <FormField label="Reason" htmlFor={`ov-reason-${employeeId}`} hint="Required. Stored with the audit entry.">
        <textarea name="reason" className={reasonClassName} maxLength={500} required />
      </FormField>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save override"}
        </Button>
      </div>
    </form>
  );
}

export function OverrideDialog(props: {
  employeeId: string;
  name: string;
  workDate: string;
  status: string | null;
  statuses: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Override
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override {props.name}</DialogTitle>
          <DialogDescription>
            {props.workDate}. Punches are kept. The nightly job will not change this day again.
          </DialogDescription>
        </DialogHeader>
        {open ? <OverrideForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

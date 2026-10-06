"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelLeaveAction,
  previewLeaveAction,
  submitLeaveAction,
  type LeaveActionState,
} from "@/app/(app)/my-space/leave/actions";
import type { LeavePreview } from "@/lib/services/leave";

const initialState: LeaveActionState = {};

const commentClassName =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type LeaveTypeOption = {
  leaveTypeId: string;
  name: string;
  halfDayAllowed: boolean;
  balance: string;
};

export function LeaveApplyForm({ types }: { types: LeaveTypeOption[] }) {
  const [state, action, pending] = useActionState(submitLeaveAction, initialState);
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.leaveTypeId ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [session, setSession] = useState("FULL");
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [previewing, startPreview] = useTransition();
  const selected = types.find((type) => type.leaveTypeId === leaveTypeId);

  useEffect(() => {
    if (!leaveTypeId) return;
    let cancelled = false;
    startPreview(async () => {
      const result = await previewLeaveAction({ leaveTypeId, startDate, endDate, session });
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [leaveTypeId, startDate, endDate, session]);

  return (
    <form action={action} className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <FormField label="Leave type" htmlFor="leave-type">
        <NativeSelect
          name="leaveTypeId"
          value={leaveTypeId}
          onChange={(event) => {
            const next = event.target.value;
            setLeaveTypeId(next);
            const type = types.find((item) => item.leaveTypeId === next);
            if (type && !type.halfDayAllowed) setSession("FULL");
          }}
        >
          {types.map((type) => (
            <option key={type.leaveTypeId} value={type.leaveTypeId}>
              {type.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="From" htmlFor="leave-from">
          <Input name="startDate" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
        </FormField>
        <FormField label="To" htmlFor="leave-to">
          <Input name="endDate" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
        </FormField>
      </div>
      <FormField
        label="Day portion"
        htmlFor="leave-session"
        hint={selected?.halfDayAllowed ? "A half day is only for a single date." : "This leave type is full days only."}
      >
        <NativeSelect name="session" value={session} onChange={(event) => setSession(event.target.value)}>
          <option value="FULL">Full day</option>
          {selected?.halfDayAllowed ? <option value="FIRST">First half</option> : null}
          {selected?.halfDayAllowed ? <option value="SECOND">Second half</option> : null}
        </NativeSelect>
      </FormField>
      <FormField label="Reason" htmlFor="leave-reason">
        <textarea id="leave-reason" name="reason" className={commentClassName} required maxLength={500} />
      </FormField>
      <div className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
        <p>Balance: {preview?.balance ?? selected?.balance ?? "—"}</p>
        <p>Working days: {previewing ? "Calculating…" : (preview?.workingDays ?? "—")}</p>
        {preview?.dates.length ? (
          <p className="mt-1 text-muted-foreground">{preview.dates.join(", ")}</p>
        ) : null}
        {preview?.message ? <p className="mt-1 text-destructive">{preview.message}</p> : null}
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-secondary">Request submitted.</p> : null}
      <div>
        <Button type="submit" disabled={pending || preview?.ok === false}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}

export function CancelLeaveForm({ requestId, label }: { requestId: string; label: string }) {
  const [state, action, pending] = useActionState(cancelLeaveAction, initialState);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
      {state.error ? <p className="mt-1 text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

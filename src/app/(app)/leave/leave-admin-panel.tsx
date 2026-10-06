"use client";

import { useActionState } from "react";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustBalanceAction, reverseLedgerAction, type LeaveAdminState } from "@/app/(app)/leave/actions";
import type { LedgerView } from "@/lib/services/leave";

const initialState: LeaveAdminState = {};

const commentClassName =
  "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type EmployeeOption = { id: string; name: string; employeeCode: string };
type TypeOption = { leaveTypeId: string; name: string };

function Message({ state }: { state: LeaveAdminState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-secondary">Saved.</p>;
  return null;
}

export function AdjustBalanceForm({
  employees,
  types,
}: {
  employees: EmployeeOption[];
  types: TypeOption[];
}) {
  const [state, action, pending] = useActionState(adjustBalanceAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Employee" htmlFor="adjust-employee">
          <NativeSelect name="employeeId" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} ({employee.employeeCode})
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Leave type" htmlFor="adjust-type">
          <NativeSelect name="leaveTypeId" required defaultValue={types[0]?.leaveTypeId ?? ""}>
            {types.map((type) => (
              <option key={type.leaveTypeId} value={type.leaveTypeId}>
                {type.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Days" htmlFor="adjust-days" hint="Use a minus sign to reduce the balance.">
          <Input name="days" required inputMode="decimal" placeholder="1.5 or -1" />
        </FormField>
      </div>
      <FormField label="Reason" htmlFor="adjust-reason">
        <textarea id="adjust-reason" name="reason" className={commentClassName} required maxLength={500} />
      </FormField>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Adjust balance"}
        </Button>
        <Message state={state} />
      </div>
    </form>
  );
}

export function ReverseLedgerForm({ row }: { row: LedgerView }) {
  const [state, action, pending] = useActionState(reverseLedgerAction, initialState);
  if (!row.canReverse) return null;
  return (
    <form action={action} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="ledgerId" value={row.id} />
      <FormField label="Reversal reason" htmlFor={`${row.id}-reason`}>
        <Input name="reason" required maxLength={500} />
      </FormField>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Reverse"}
      </Button>
      <Message state={state} />
    </form>
  );
}

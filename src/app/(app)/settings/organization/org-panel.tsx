"use client";

import { useActionState } from "react";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createDepartmentAction,
  createDesignationAction,
  createLocationAction,
  updateDepartmentAction,
  updateDesignationAction,
  updateLocationAction,
  type OrgActionState,
} from "@/app/(app)/settings/organization/actions";

const initialState: OrgActionState = {};

type Row = { id: string; name: string; isActive: boolean; city?: string | null };

function Message({ state }: { state: OrgActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-secondary">Saved.</p>;
  return null;
}

function AddForm({
  label,
  action,
  withCity,
}: {
  label: string;
  action: (previous: OrgActionState, formData: FormData) => Promise<OrgActionState>;
  withCity?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <FormField label={`${label} name`} htmlFor={`add-${label}`}>
        <Input name="name" required />
      </FormField>
      {withCity ? (
        <FormField label="City" htmlFor={`add-${label}-city`}>
          <Input name="city" />
        </FormField>
      ) : (
        <div className="hidden sm:block" />
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : `Add ${label.toLowerCase()}`}
      </Button>
      <div className="sm:col-span-3">
        <Message state={state} />
      </div>
    </form>
  );
}

function RowForm({
  row,
  action,
  withCity,
}: {
  row: Row;
  action: (previous: OrgActionState, formData: FormData) => Promise<OrgActionState>;
  withCity?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
      <input type="hidden" name="id" value={row.id} />
      <FormField label="Name" htmlFor={`${row.id}-name`}>
        <Input name="name" defaultValue={row.name} required />
      </FormField>
      {withCity ? (
        <FormField label="City" htmlFor={`${row.id}-city`}>
          <Input name="city" defaultValue={row.city ?? ""} />
        </FormField>
      ) : (
        <div className="hidden sm:block" />
      )}
      <FormField label="Status" htmlFor={`${row.id}-active`}>
        <NativeSelect name="isActive" defaultValue={row.isActive ? "true" : "false"}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </NativeSelect>
      </FormField>
      <div className="flex items-center gap-2">
        <StatusBadge status={row.isActive ? "success" : "neutral"}>
          {row.isActive ? "Active" : "Inactive"}
        </StatusBadge>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="sm:col-span-4">
        <Message state={state} />
      </div>
    </form>
  );
}

export function OrgPanel({
  departments,
  designations,
  locations,
}: {
  departments: Row[];
  designations: Row[];
  locations: Row[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-medium text-foreground">Departments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Inactive departments stay on old job rows and cannot be chosen for a new one.
        </p>
        <div className="mt-4">
          <AddForm label="Department" action={createDepartmentAction} />
          {departments.map((row) => (
            <RowForm key={row.id} row={row} action={updateDepartmentAction} />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-medium text-foreground">Designations</h2>
        <div className="mt-4">
          <AddForm label="Designation" action={createDesignationAction} />
          {designations.map((row) => (
            <RowForm key={row.id} row={row} action={updateDesignationAction} />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-medium text-foreground">Locations</h2>
        <div className="mt-4">
          <AddForm label="Location" action={createLocationAction} withCity />
          {locations.map((row) => (
            <RowForm key={row.id} row={row} action={updateLocationAction} withCity />
          ))}
        </div>
      </section>
    </div>
  );
}

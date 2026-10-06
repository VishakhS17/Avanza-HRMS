"use client";

import { useActionState } from "react";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EMPLOYEE_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  SENSITIVE_FIELDS,
  type SensitiveField,
} from "@/lib/employee-labels";
import {
  createEmployeeAction,
  revealSensitiveAction,
  updateJobAction,
  updateOwnContactAction,
  updateProfileAction,
  updateSensitiveAction,
  updateStatusAction,
  type EmployeeActionState,
} from "@/app/(app)/people/actions";

const initialState: EmployeeActionState = {};

export type NamedOption = { id: string; name: string };
export type ManagerOption = { id: string; name: string; employeeCode: string };

const SENSITIVE_LABELS: Record<SensitiveField, string> = {
  bankAccountName: "Account holder",
  bankName: "Bank name",
  bankAccountNumber: "Account number",
  bankIfsc: "IFSC",
  pan: "PAN",
  governmentId: "Government ID",
};

function ActionMessage({ state }: { state: EmployeeActionState }) {
  if (state.error) {
    return <p className="text-sm text-destructive">{state.error}</p>;
  }
  if (state.revealed) {
    return <p className="text-sm font-medium text-foreground">{state.revealed}</p>;
  }
  if (state.ok) {
    return <p className="text-sm text-secondary">Saved.</p>;
  }
  return null;
}

function ContactFields({ defaults }: { defaults?: Record<string, string> }) {
  return (
    <>
      <FormField label="Phone" htmlFor={`${defaults?.formId ?? "new"}-phone`}>
        <Input name="phone" defaultValue={defaults?.phone ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="Address" htmlFor={`${defaults?.formId ?? "new"}-address1`}>
        <Input name="addressLine1" defaultValue={defaults?.addressLine1 ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="Address line 2" htmlFor={`${defaults?.formId ?? "new"}-address2`}>
        <Input name="addressLine2" defaultValue={defaults?.addressLine2 ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="City" htmlFor={`${defaults?.formId ?? "new"}-city`}>
        <Input name="city" defaultValue={defaults?.city ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="State" htmlFor={`${defaults?.formId ?? "new"}-state`}>
        <Input name="state" defaultValue={defaults?.state ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="Postal code" htmlFor={`${defaults?.formId ?? "new"}-postal`}>
        <Input name="postalCode" defaultValue={defaults?.postalCode ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="Country" htmlFor={`${defaults?.formId ?? "new"}-country`}>
        <Input name="country" defaultValue={defaults?.country ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="Emergency contact" htmlFor={`${defaults?.formId ?? "new"}-emergency-name`}>
        <Input name="emergencyName" defaultValue={defaults?.emergencyName ?? ""} autoComplete="off" />
      </FormField>
      <FormField label="Relationship" htmlFor={`${defaults?.formId ?? "new"}-emergency-relation`}>
        <Input
          name="emergencyRelation"
          defaultValue={defaults?.emergencyRelation ?? ""}
          autoComplete="off"
        />
      </FormField>
      <FormField label="Emergency phone" htmlFor={`${defaults?.formId ?? "new"}-emergency-phone`}>
        <Input name="emergencyPhone" defaultValue={defaults?.emergencyPhone ?? ""} autoComplete="off" />
      </FormField>
    </>
  );
}

function JobFields({
  formId,
  departments,
  designations,
  locations,
  managers,
  defaults,
}: {
  formId: string;
  departments: NamedOption[];
  designations: NamedOption[];
  locations: NamedOption[];
  managers: ManagerOption[];
  defaults?: {
    departmentId?: string;
    designationId?: string;
    locationId?: string;
    reportingManagerId?: string;
    employmentType?: string;
  };
}) {
  return (
    <>
      <FormField label="Department" htmlFor={`${formId}-department`}>
        <NativeSelect name="departmentId" defaultValue={defaults?.departmentId ?? ""} required>
          <option value="">Select</option>
          {departments.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Designation" htmlFor={`${formId}-designation`}>
        <NativeSelect name="designationId" defaultValue={defaults?.designationId ?? ""} required>
          <option value="">Select</option>
          {designations.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Location" htmlFor={`${formId}-location`}>
        <NativeSelect name="locationId" defaultValue={defaults?.locationId ?? ""} required>
          <option value="">Select</option>
          {locations.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Employment type" htmlFor={`${formId}-type`}>
        <NativeSelect name="employmentType" defaultValue={defaults?.employmentType ?? "FULL_TIME"} required>
          {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Reporting manager" htmlFor={`${formId}-manager`}>
        <NativeSelect name="reportingManagerId" defaultValue={defaults?.reportingManagerId ?? ""}>
          <option value="">None</option>
          {managers.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} ({row.employeeCode})
            </option>
          ))}
        </NativeSelect>
      </FormField>
    </>
  );
}

export function CreateEmployeeForm({
  departments,
  designations,
  locations,
  managers,
  canWriteSensitive,
}: {
  departments: NamedOption[];
  designations: NamedOption[];
  locations: NamedOption[];
  managers: ManagerOption[];
  canWriteSensitive: boolean;
}) {
  const [state, action, pending] = useActionState(createEmployeeAction, initialState);

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <FormField label="Employee code" htmlFor="new-code">
        <Input name="employeeCode" required autoComplete="off" />
      </FormField>
      <FormField label="Name" htmlFor="new-name">
        <Input name="name" required autoComplete="name" />
      </FormField>
      <FormField label="Work email" htmlFor="new-email">
        <Input name="workEmail" type="email" required autoComplete="off" />
      </FormField>
      <FormField label="Joining date" htmlFor="new-joining">
        <Input name="joiningDate" type="date" required />
      </FormField>
      <FormField label="Date of birth" htmlFor="new-dob">
        <Input name="dateOfBirth" type="date" />
      </FormField>
      <FormField label="Gender" htmlFor="new-gender">
        <NativeSelect name="gender" defaultValue="">
          <option value="">Not set</option>
          {GENDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Status" htmlFor="new-status">
        <NativeSelect name="status" defaultValue="ACTIVE" required>
          {EMPLOYEE_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <JobFields
        formId="new"
        departments={departments}
        designations={designations}
        locations={locations}
        managers={managers}
      />
      <ContactFields defaults={{ formId: "new" }} />
      {canWriteSensitive ? (
        <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
          <p className="md:col-span-2 text-sm text-muted-foreground">
            Bank details and ID numbers are encrypted. Leave them blank if you do not have them yet.
          </p>
          {SENSITIVE_FIELDS.map((field) => (
            <FormField key={field} label={SENSITIVE_LABELS[field]} htmlFor={`new-${field}`}>
              <Input name={field} autoComplete="off" />
            </FormField>
          ))}
        </div>
      ) : null}
      <div className="md:col-span-2 space-y-3">
        <ActionMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create employee"}
        </Button>
      </div>
    </form>
  );
}

export type ProfileFormValues = {
  employeeId: string;
  employeeCode: string;
  name: string;
  workEmail: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  joiningDate: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
};

export function EditProfileForm({ values }: { values: ProfileFormValues }) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="employeeId" value={values.employeeId} />
      <FormField label="Employee code" htmlFor="edit-code">
        <Input name="employeeCode" defaultValue={values.employeeCode} required />
      </FormField>
      <FormField label="Name" htmlFor="edit-name">
        <Input name="name" defaultValue={values.name} required />
      </FormField>
      <FormField label="Work email" htmlFor="edit-email">
        <Input name="workEmail" type="email" defaultValue={values.workEmail} required />
      </FormField>
      <FormField label="Joining date" htmlFor="edit-joining">
        <Input name="joiningDate" type="date" defaultValue={values.joiningDate} required />
      </FormField>
      <FormField label="Date of birth" htmlFor="edit-dob">
        <Input name="dateOfBirth" type="date" defaultValue={values.dateOfBirth} />
      </FormField>
      <FormField label="Gender" htmlFor="edit-gender">
        <NativeSelect name="gender" defaultValue={values.gender}>
          <option value="">Not set</option>
          {GENDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <ContactFields defaults={{ formId: "edit", ...values }} />
      <div className="md:col-span-2 space-y-3">
        <ActionMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

export function EditJobForm({
  employeeId,
  departments,
  designations,
  locations,
  managers,
  defaults,
}: {
  employeeId: string;
  departments: NamedOption[];
  designations: NamedOption[];
  locations: NamedOption[];
  managers: ManagerOption[];
  defaults: {
    departmentId: string;
    designationId: string;
    locationId: string;
    reportingManagerId: string;
    employmentType: string;
  };
}) {
  const [state, action, pending] = useActionState(updateJobAction, initialState);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <JobFields
        formId="job"
        departments={departments}
        designations={designations}
        locations={locations}
        managers={managers}
        defaults={defaults}
      />
      <FormField
        label="Effective date"
        htmlFor="job-start"
        hint="Closes the current job the day before this date and adds a new row."
      >
        <Input name="startDate" type="date" required />
      </FormField>
      <div className="md:col-span-2 space-y-3">
        <ActionMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save job change"}
        </Button>
      </div>
    </form>
  );
}

export function EditStatusForm({ employeeId, status }: { employeeId: string; status: string }) {
  const [state, action, pending] = useActionState(updateStatusAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="min-w-48 flex-1">
        <FormField label="Status" htmlFor="status-select">
          <NativeSelect name="status" defaultValue={status}>
            {EMPLOYEE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Update status"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function SensitiveForm({
  employeeId,
  masked,
}: {
  employeeId: string;
  masked: Record<SensitiveField, string | null>;
}) {
  const [state, action, pending] = useActionState(updateSensitiveAction, initialState);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <p className="md:col-span-2 text-sm text-muted-foreground">
        Leave a field blank to keep the current value. Tick clear to remove it. Values are encrypted.
      </p>
      {SENSITIVE_FIELDS.map((field) => (
        <div key={field} className="space-y-2">
          <FormField label={SENSITIVE_LABELS[field]} htmlFor={`sensitive-${field}`}>
            <Input name={field} autoComplete="off" placeholder={masked[field] ?? "Not on file"} />
          </FormField>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" name="clear" value={field} className="accent-primary" />
            Clear {SENSITIVE_LABELS[field].toLowerCase()}
          </label>
        </div>
      ))}
      <div className="md:col-span-2 space-y-3">
        <ActionMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save sensitive fields"}
        </Button>
      </div>
    </form>
  );
}

export function RevealField({
  employeeId,
  field,
  masked,
}: {
  employeeId: string;
  field: SensitiveField;
  masked: string | null;
}) {
  const [state, action, pending] = useActionState(revealSensitiveAction, initialState);
  if (!masked) {
    return <span>—</span>;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="field" value={field} />
      <span>{state.revealed ?? masked}</span>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Showing…" : "Show"}
      </Button>
    </form>
  );
}

export function OwnContactForm({
  defaults,
}: {
  defaults: {
    phone: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    emergencyName: string;
    emergencyRelation: string;
    emergencyPhone: string;
  };
}) {
  const [state, action, pending] = useActionState(updateOwnContactAction, initialState);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <ContactFields defaults={{ formId: "me", ...defaults }} />
      <div className="md:col-span-2 space-y-3">
        <ActionMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save contact details"}
        </Button>
      </div>
    </form>
  );
}

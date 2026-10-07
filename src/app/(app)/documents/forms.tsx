"use client";

import { useActionState, useState } from "react";
import {
  addHrVersionAction,
  assignDocumentAction,
  assignMissingAction,
  removeHrDocumentAction,
  updateDocumentAction,
  uploadHrDocumentAction,
} from "@/app/(app)/documents/actions";
import { ActionMessage, fileHint, textAreaClassName } from "@/components/documents/action-message";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentVisibility, EmployeeStatus } from "@/generated/prisma/client";
import type { DocumentActionState } from "@/lib/document-actions";
import { VISIBILITY_OPTIONS, visibilityLabel } from "@/lib/document-labels";
import { UPLOAD_ACCEPT } from "@/lib/storage/files";

const initialState: DocumentActionState = {};

type CategoryOption = {
  code: string;
  name: string;
  uploader: "EMPLOYEE" | "HR";
  defaultVisibility: DocumentVisibility;
  shared: boolean;
};

type EmployeeOption = { id: string; name: string; employeeCode: string; status: EmployeeStatus };

function VisibilitySelect({
  defaultVisibility,
  value,
}: {
  defaultVisibility: DocumentVisibility;
  value?: DocumentVisibility | null;
}) {
  return (
    <NativeSelect name="visibility" defaultValue={value ?? ""}>
      <option value="">Category default ({visibilityLabel(defaultVisibility)})</option>
      {VISIBILITY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function EmployeeChecklist({ employees }: { employees: EmployeeOption[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const matches = (employee: EmployeeOption) =>
    !q || employee.name.toLowerCase().includes(q) || employee.employeeCode.toLowerCase().includes(q);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or code"
          aria-label="Search employees"
          className="max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSelected(new Set(employees.filter((row) => row.status === "ACTIVE").map((row) => row.id)))}
        >
          Select all active
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setSelected(new Set())}>
          Clear
        </Button>
        <span className="text-sm text-muted-foreground">{selected.size} selected</span>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        {employees.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No employees to choose.</p>
        ) : (
          employees.map((employee) => (
            <label
              key={employee.id}
              className={`flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 ${matches(employee) ? "" : "hidden"}`}
            >
              <input
                type="checkbox"
                name="employeeIds"
                value={employee.id}
                checked={selected.has(employee.id)}
                onChange={(event) => toggle(employee.id, event.target.checked)}
              />
              <span className="text-foreground">{employee.name}</span>
              <span className="text-muted-foreground">
                {employee.employeeCode}
                {employee.status === "ACTIVE" ? "" : ` · ${employee.status === "PRE_JOINING" ? "Pre-joining" : "On notice"}`}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export function HrUploadForm({
  categories,
  employees: allEmployees,
  selfId,
}: {
  categories: CategoryOption[];
  employees: EmployeeOption[];
  selfId: string;
}) {
  const [state, action, pending] = useActionState(uploadHrDocumentAction, initialState);
  const [categoryCode, setCategoryCode] = useState(categories.find((row) => row.uploader === "HR")?.code ?? "");
  const category = categories.find((row) => row.code === categoryCode);
  const onBehalf = category?.uploader === "EMPLOYEE";
  const employees = categoryCode === "POLICIES" ? allEmployees : allEmployees.filter((row) => row.id !== selfId);

  return (
    <form action={action} className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Category"
          htmlFor="hr-category"
          hint={onBehalf ? "An employee category. You are uploading on the employee's behalf." : undefined}
        >
          <NativeSelect name="categoryCode" value={categoryCode} onChange={(event) => setCategoryCode(event.target.value)}>
            <optgroup label="HR documents">
              {categories
                .filter((row) => row.uploader === "HR")
                .map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="On behalf of an employee">
              {categories
                .filter((row) => row.uploader === "EMPLOYEE")
                .map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.name}
                  </option>
                ))}
            </optgroup>
          </NativeSelect>
        </FormField>
        <FormField label="Title" htmlFor="hr-title">
          <Input name="title" required maxLength={120} />
        </FormField>
      </div>
      {category?.shared ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Employees</p>
          <EmployeeChecklist key={categoryCode} employees={employees} />
        </div>
      ) : (
        <FormField label="Employee" htmlFor="hr-employee">
          <NativeSelect key={categoryCode} name="employeeIds" required defaultValue="">
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
      )}
      {onBehalf ? (
        <FormField
          label="Uploaded on behalf of"
          htmlFor="hr-on-behalf"
          hint="Required. For example, “Paper copy collected at the Pune depot on 7 Oct.” Shown to the employee and kept in the audit log."
        >
          <Input name="onBehalfNote" required minLength={3} maxLength={200} />
        </FormField>
      ) : null}
      <FormField label="Description" htmlFor="hr-description" hint="Optional.">
        <textarea name="description" className={textAreaClassName} maxLength={500} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Who can see it" htmlFor="hr-visibility">
          <VisibilitySelect key={categoryCode} defaultVisibility={category?.defaultVisibility ?? "EMPLOYEE_AND_HR"} />
        </FormField>
        <FormField label="Expiry date" htmlFor="hr-expiry" hint="Optional. No reminders are sent yet.">
          <Input name="expiresOn" type="date" />
        </FormField>
      </div>
      {!onBehalf ? (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="requiresAcknowledgement" />
          Requires acknowledgement
        </label>
      ) : null}
      <FormField label="File" htmlFor="hr-file" hint={fileHint}>
        <Input name="file" type="file" accept={UPLOAD_ACCEPT} required />
      </FormField>
      <ActionMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}

export function DocumentDetailsForm({
  document,
}: {
  document: {
    id: string;
    title: string;
    description: string | null;
    visibilityOverride: DocumentVisibility | null;
    requiresAcknowledgement: boolean;
    expiresOn: string | null;
    category: CategoryOption;
  };
}) {
  const [state, action, pending] = useActionState(updateDocumentAction, initialState);
  return (
    <form action={action} className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="documentId" value={document.id} />
      <FormField label="Title" htmlFor="edit-title">
        <Input name="title" required maxLength={120} defaultValue={document.title} />
      </FormField>
      <FormField label="Description" htmlFor="edit-description">
        <textarea
          name="description"
          className={textAreaClassName}
          maxLength={500}
          defaultValue={document.description ?? ""}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Who can see it" htmlFor="edit-visibility">
          <VisibilitySelect defaultVisibility={document.category.defaultVisibility} value={document.visibilityOverride} />
        </FormField>
        <FormField label="Expiry date" htmlFor="edit-expiry">
          <Input name="expiresOn" type="date" defaultValue={document.expiresOn ?? ""} />
        </FormField>
      </div>
      {document.category.uploader === "HR" ? (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="requiresAcknowledgement" defaultChecked={document.requiresAcknowledgement} />
          Requires acknowledgement
        </label>
      ) : null}
      <ActionMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}

export function HrVersionForm({ documentId, needsNote }: { documentId: string; needsNote: boolean }) {
  const [state, action, pending] = useActionState(addHrVersionAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="documentId" value={documentId} />
      <FormField label="File" htmlFor="version-file" hint={fileHint}>
        <Input name="file" type="file" accept={UPLOAD_ACCEPT} required />
      </FormField>
      {needsNote ? (
        <FormField label="Uploaded on behalf of" htmlFor="version-note" hint="Required for employee categories.">
          <Input name="onBehalfNote" required minLength={3} maxLength={200} />
        </FormField>
      ) : null}
      <ActionMessage state={state} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Uploading…" : "Upload new version"}
        </Button>
      </div>
    </form>
  );
}

export function AssignForm({ documentId, employees }: { documentId: string; employees: EmployeeOption[] }) {
  const [state, action, pending] = useActionState(assignDocumentAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="documentId" value={documentId} />
      <EmployeeChecklist employees={employees} />
      <ActionMessage state={state} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Assigning…" : "Assign selected"}
        </Button>
      </div>
    </form>
  );
}

export function AssignMissingForm({ documentId, missingCount }: { documentId: string; missingCount: number }) {
  const [state, action, pending] = useActionState(assignMissingAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <div>
        <Button type="submit" disabled={pending || missingCount === 0}>
          {pending
            ? "Assigning…"
            : missingCount === 0
              ? "Every active employee has this"
              : `Assign to ${missingCount} active ${missingCount === 1 ? "employee" : "employees"} missing this document`}
        </Button>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}

export function HrRemoveForm({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(removeHrDocumentAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <input type="hidden" name="documentId" value={documentId} />
      <FormField
        label="Reason"
        htmlFor="remove-reason"
        hint="Employees stop seeing it. HR keeps every version for audit and retention."
      >
        <Input name="reason" required minLength={3} maxLength={300} />
      </FormField>
      <ActionMessage state={state} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Removing…" : "Remove document"}
        </Button>
      </div>
    </form>
  );
}

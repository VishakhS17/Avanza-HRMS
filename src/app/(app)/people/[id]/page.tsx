import type { Metadata } from "next";
import Link from "next/link";
import {
  EditJobForm,
  EditProfileForm,
  EditStatusForm,
  RevealField,
  SensitiveForm,
} from "@/app/(app)/people/forms";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DetailList, Panel } from "@/components/employees/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  employeeStatusLabel,
  employeeStatusTone,
  employmentTypeLabel,
  genderLabel,
  SENSITIVE_FIELDS,
  type SensitiveField,
} from "@/lib/employee-labels";
import { redirectEmployeeAccess } from "@/lib/employee-page";
import { can } from "@/lib/permissions";
import { requireCan } from "@/lib/services/current-user";
import {
  getEmployeeForActor,
  listManagerChoices,
  type EmployeeHistoryRow,
} from "@/lib/services/employees";
import { listDepartments, listDesignations, listLocations } from "@/lib/services/organization";

export const metadata: Metadata = {
  title: "Employee",
};

const SENSITIVE_LABELS: Record<SensitiveField, string> = {
  bankAccountName: "Account holder",
  bankName: "Bank name",
  bankAccountNumber: "Account number",
  bankIfsc: "IFSC",
  pan: "PAN",
  governmentId: "Government ID",
};

const historyColumns: DataTableColumn<EmployeeHistoryRow>[] = [
  { id: "start", header: "From", cell: (row) => row.startDate },
  { id: "end", header: "To", cell: (row) => row.endDate ?? "Current" },
  { id: "designation", header: "Designation", cell: (row) => row.designation },
  { id: "department", header: "Department", cell: (row) => row.department },
  { id: "location", header: "Location", cell: (row) => row.location },
  { id: "type", header: "Type", cell: (row) => employmentTypeLabel(row.employmentType) },
  { id: "manager", header: "Manager", cell: (row) => row.reportingManager ?? "—" },
];

function keepCurrent(
  options: { id: string; name: string }[],
  current?: { id: string; name: string },
) {
  if (!current || options.some((option) => option.id === current.id)) return options;
  return [...options, { id: current.id, name: current.name }];
}

function tabFrom(value: string | string[] | undefined): "overview" | "job" | "personal" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "job" || raw === "personal") return raw;
  return "overview";
}

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const user = await requireCan("people.view");
  const tab = tabFrom((await searchParams).tab);
  let record;
  try {
    record = await getEmployeeForActor(user, id);
  } catch (error) {
    redirectEmployeeAccess(error);
  }

  const [activeDepartments, activeDesignations, activeLocations, managers] = await Promise.all([
    listDepartments(user.id, { activeOnly: true }),
    listDesignations(user.id, { activeOnly: true }),
    listLocations(user.id, { activeOnly: true }),
    listManagerChoices(user.id, record.id),
  ]);
  const departments = keepCurrent(activeDepartments, record.job?.department);
  const designations = keepCurrent(activeDesignations, record.job?.designation);
  const locations = keepCurrent(activeLocations, record.job?.location);
  const canReveal = can(user, "employee.sensitive.view");
  const personal = record.personal;
  const tabs = [
    ["overview", "Overview"],
    ["job", "Job"],
    ["personal", "Personal"],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={record.name}
        description={`${record.employeeCode} · ${record.workEmail}`}
        actions={
          <>
            {can(user, "documents.manage") && record.id !== user.id ? (
              <Link href={`/documents?employee=${record.id}`} className="text-sm text-secondary hover:underline">
                Documents
              </Link>
            ) : null}
            <StatusBadge status={employeeStatusTone(record.status)}>
              {employeeStatusLabel(record.status)}
            </StatusBadge>
          </>
        }
      />
      <div className="flex gap-4 border-b border-border">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/people/${record.id}?tab=${key}`}
            className={
              key === tab
                ? "border-b-2 border-primary px-1 pb-2 text-sm font-medium text-foreground"
                : "px-1 pb-2 text-sm text-muted-foreground"
            }
            aria-current={key === tab ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="flex flex-col gap-4">
          <Panel title="Overview">
            <DetailList
              items={[
                { label: "Employee code", value: record.employeeCode },
                { label: "Work email", value: record.workEmail },
                { label: "Phone", value: record.phone },
                { label: "Joining date", value: record.joiningDate },
                { label: "Department", value: record.job?.department.name },
                { label: "Designation", value: record.job?.designation.name },
                { label: "Location", value: record.job?.location.name },
                { label: "Manager", value: record.job?.reportingManager?.name },
                {
                  label: "Employment type",
                  value: record.job ? employmentTypeLabel(record.job.employmentType) : null,
                },
              ]}
            />
          </Panel>
          <Panel title="Status" description="Exited employees are signed out and are not hard-deleted.">
            <EditStatusForm employeeId={record.id} status={record.status} />
          </Panel>
          {personal ? (
            <Panel title="Edit profile" description="Work email is also the sign-in address.">
              <EditProfileForm
                values={{
                  employeeId: record.id,
                  employeeCode: record.employeeCode,
                  name: record.name,
                  workEmail: record.workEmail,
                  phone: record.phone ?? "",
                  dateOfBirth: personal.dateOfBirth ?? "",
                  gender: personal.gender ?? "",
                  joiningDate: record.joiningDate,
                  addressLine1: personal.addressLine1 ?? "",
                  addressLine2: personal.addressLine2 ?? "",
                  city: personal.city ?? "",
                  state: personal.state ?? "",
                  postalCode: personal.postalCode ?? "",
                  country: personal.country ?? "",
                  emergencyName: personal.emergencyName ?? "",
                  emergencyRelation: personal.emergencyRelation ?? "",
                  emergencyPhone: personal.emergencyPhone ?? "",
                }}
              />
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === "job" ? (
        <div className="flex flex-col gap-4">
          <Panel
            title="Change job"
            description="Promotions, transfers, and manager changes add a new effective-dated row."
          >
            {record.job ? (
              <EditJobForm
                employeeId={record.id}
                departments={departments}
                designations={designations}
                locations={locations}
                managers={managers}
                defaults={{
                  departmentId: record.job.department.id,
                  designationId: record.job.designation.id,
                  locationId: record.job.location.id,
                  reportingManagerId: record.job.reportingManager?.id ?? "",
                  employmentType: record.job.employmentType,
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">This employee has no current job.</p>
            )}
          </Panel>
          <DataTable
            columns={historyColumns}
            data={record.history ?? []}
            getRowKey={(row) => row.id}
            emptyTitle="No job history"
            emptyDescription="The current job will appear here."
          />
        </div>
      ) : null}

      {tab === "personal" && personal ? (
        <div className="flex flex-col gap-4">
          <Panel title="Personal">
            <DetailList
              items={[
                { label: "Date of birth", value: personal.dateOfBirth },
                { label: "Gender", value: genderLabel(personal.gender) },
                { label: "Address", value: [personal.addressLine1, personal.addressLine2].filter(Boolean).join(", ") },
                { label: "City", value: personal.city },
                { label: "State", value: personal.state },
                { label: "Postal code", value: personal.postalCode },
                { label: "Country", value: personal.country },
                { label: "Emergency contact", value: personal.emergencyName },
                { label: "Relationship", value: personal.emergencyRelation },
                { label: "Emergency phone", value: personal.emergencyPhone },
              ]}
            />
          </Panel>
          <Panel
            title="Sensitive fields"
            description="Masked by default. HR Admin can reveal one field, and that reveal is audited."
          >
            <DetailList
              items={SENSITIVE_FIELDS.map((field) => ({
                label: SENSITIVE_LABELS[field],
                value: canReveal ? (
                  <RevealField
                    employeeId={record.id}
                    field={field}
                    masked={personal.sensitive[field]}
                  />
                ) : (
                  (personal.sensitive[field] ?? "—")
                ),
              }))}
            />
            {canReveal ? (
              <div className="mt-6">
                <SensitiveForm employeeId={record.id} masked={personal.sensitive} />
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Only HR Admin can view or change these values.
              </p>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

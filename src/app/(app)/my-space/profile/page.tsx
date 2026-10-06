import type { Metadata } from "next";
import { OwnContactForm, RevealField } from "@/app/(app)/people/forms";
import { DetailList, Panel } from "@/components/employees/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
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
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/services/current-user";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import {
  getEmployeeForActor,
  type EmployeeRecord,
} from "@/lib/services/employees";

export const metadata: Metadata = {
  title: "Profile",
};

const SENSITIVE_LABELS: Record<SensitiveField, string> = {
  bankAccountName: "Account holder",
  bankName: "Bank name",
  bankAccountNumber: "Account number",
  bankIfsc: "IFSC",
  pan: "PAN",
  governmentId: "Government ID",
};

export default async function ProfilePage() {
  const user = await requireUser();
  let record: EmployeeRecord | null = null;
  try {
    record = await getEmployeeForActor(user, user.id);
  } catch (error) {
    if (!(error instanceof EmployeeAccessError && error.kind === "not-found")) {
      throw error;
    }
  }

  if (!record?.personal) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Profile" description="Your personal and job details." />
        <EmptyState
          title="No employee record yet"
          description="HR creates your employee record. Until then, this page stays empty."
        />
      </div>
    );
  }

  const personal = record.personal;
  const canReveal = can(user, "employee.sensitive.view");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={record.name}
        description={record.workEmail}
        actions={
          <StatusBadge status={employeeStatusTone(record.status)}>
            {employeeStatusLabel(record.status)}
          </StatusBadge>
        }
      />
      <Panel title="Job" description="Ask HR to change your role, manager, or work email.">
        <DetailList
          items={[
            { label: "Employee code", value: record.employeeCode },
            { label: "Work email", value: record.workEmail },
            { label: "Joining date", value: record.joiningDate },
            { label: "Department", value: record.job?.department.name },
            { label: "Designation", value: record.job?.designation.name },
            { label: "Location", value: record.job?.location.name },
            { label: "Manager", value: record.job?.reportingManager?.name },
            {
              label: "Employment type",
              value: record.job ? employmentTypeLabel(record.job.employmentType) : null,
            },
            { label: "Date of birth", value: personal.dateOfBirth },
            { label: "Gender", value: genderLabel(personal.gender) },
          ]}
        />
      </Panel>
      <Panel title="Contact and emergency" description="You can update these. Everything else is read-only.">
        <OwnContactForm
          defaults={{
            phone: record.phone ?? "",
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
      <Panel title="Sensitive fields" description="Masked. Only HR Admin can reveal a value, and that is audited.">
        <DetailList
          items={SENSITIVE_FIELDS.map((field) => ({
            label: SENSITIVE_LABELS[field],
            value: canReveal ? (
              <RevealField employeeId={record.id} field={field} masked={personal.sensitive[field]} />
            ) : (
              (personal.sensitive[field] ?? "—")
            ),
          }))}
        />
      </Panel>
    </div>
  );
}

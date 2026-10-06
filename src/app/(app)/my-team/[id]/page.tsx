import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DetailList, Panel } from "@/components/employees/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { employeeStatusLabel, employeeStatusTone, employmentTypeLabel } from "@/lib/employee-labels";
import { redirectEmployeeAccess } from "@/lib/employee-page";
import { can } from "@/lib/permissions";
import { requireCan } from "@/lib/services/current-user";
import { getEmployeeForActor } from "@/lib/services/employees";

export const metadata: Metadata = {
  title: "Team member",
};

export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCan("team.view");
  if (!can(user, "people.view") && !user.directReportIds.includes(id)) {
    redirect("/forbidden");
  }

  let record;
  try {
    record = await getEmployeeForActor(user, id);
  } catch (error) {
    redirectEmployeeAccess(error);
  }

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
      <Panel title="Work details" description="Direct reports only. Personal and sensitive fields stay with HR.">
        <DetailList
          items={[
            { label: "Employee code", value: record.employeeCode },
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
            { label: "Job start", value: record.job?.startDate },
          ]}
        />
      </Panel>
    </div>
  );
}

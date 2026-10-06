import type { Metadata } from "next";
import { OrgPanel } from "@/app/(app)/settings/organization/org-panel";
import { PageHeader } from "@/components/shared/page-header";
import { requireCan } from "@/lib/services/current-user";
import { listDepartments, listDesignations, listLocations } from "@/lib/services/organization";

export const metadata: Metadata = {
  title: "Organization",
};

export default async function OrganizationSettingsPage() {
  const user = await requireCan("settings.view");
  const [departments, designations, locations] = await Promise.all([
    listDepartments(user.id),
    listDesignations(user.id),
    listLocations(user.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Organization"
        description="Departments, designations, and locations used on employee job rows."
      />
      <OrgPanel departments={departments} designations={designations} locations={locations} />
    </div>
  );
}

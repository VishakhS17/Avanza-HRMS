import type { Metadata } from "next";
import Link from "next/link";
import { CreateEmployeeForm } from "@/app/(app)/people/forms";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireCan } from "@/lib/services/current-user";
import { listManagerChoices } from "@/lib/services/employees";
import { listDepartments, listDesignations, listLocations } from "@/lib/services/organization";

export const metadata: Metadata = {
  title: "Add employee",
};

export default async function NewEmployeePage() {
  const user = await requireCan("people.view");
  const [departments, designations, locations, managers] = await Promise.all([
    listDepartments(user.id, { activeOnly: true }),
    listDesignations(user.id, { activeOnly: true }),
    listLocations(user.id, { activeOnly: true }),
    listManagerChoices(user.id),
  ]);
  const ready = departments.length > 0 && designations.length > 0 && locations.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add employee"
        description="Creates the employee record and a user account on the company domain so they can sign in."
      />
      {ready ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <CreateEmployeeForm
            departments={departments}
            designations={designations}
            locations={locations}
            managers={managers}
            canWriteSensitive={can(user, "employee.sensitive.view")}
          />
        </section>
      ) : (
        <EmptyState
          title="Add organization masters first"
          description="An employee needs an active department, designation, and location."
          action={
            <Button asChild>
              <Link href="/settings/organization">Open organization settings</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

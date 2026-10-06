import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireCan } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const user = await requireCan("settings.view");
  const canManageUsers = can(user, "users.manage");
  const canViewAudit = can(user, "audit.view");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Workspace administration for HR Admin and Super Admin."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {canManageUsers ? (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-medium text-foreground">Users and roles</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create users, assign roles, and deactivate or reactivate accounts. Super Admin only.
            </p>
            <div className="mt-4">
              <Button asChild>
                <Link href="/settings/users">Open users</Link>
              </Button>
            </div>
          </section>
        ) : null}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-medium text-foreground">Organization</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Departments, designations, and locations. Inactive rows stay on job history.
          </p>
          <div className="mt-4">
            <Button variant="secondary" asChild>
              <Link href="/settings/organization">Manage organization</Link>
            </Button>
          </div>
        </section>
        {canViewAudit ? (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-medium text-foreground">Audit log</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Review changes by date, actor, action, and entity. Rows are append-only.
            </p>
            <div className="mt-4">
              <Button variant="secondary" asChild>
                <Link href="/settings/audit-log">Open audit log</Link>
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

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
  const canManageAttendance = can(user, "attendance.manage");

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
          <h2 className="text-base font-medium text-foreground">Holiday calendar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Holidays and the weekly off for each location. Leave uses these when it counts working days.
          </p>
          <div className="mt-4">
            <Button variant="secondary" asChild>
              <Link href="/settings/holidays">Manage holidays</Link>
            </Button>
          </div>
        </section>
        {canManageAttendance ? (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-medium text-foreground">Shifts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One shift per location: start, end, grace, and half-day and full-day hours. Night shifts are supported.
            </p>
            <div className="mt-4">
              <Button variant="secondary" asChild>
                <Link href="/settings/shifts">Manage shifts</Link>
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

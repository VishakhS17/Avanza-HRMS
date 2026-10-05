import type { Metadata } from "next";
import Link from "next/link";
import { CreateUserForm, UserAdminPanel } from "@/app/(app)/settings/users/user-admin-panel";
import { PageHeader } from "@/components/shared/page-header";
import { requireCan } from "@/lib/services/current-user";
import { listUsers } from "@/lib/services/users";

export const metadata: Metadata = {
  title: "Users and roles",
};

export default async function UsersPage() {
  const actor = await requireCan("users.manage");
  const users = await listUsers();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/settings" className="text-sm font-medium text-secondary hover:underline">
        Back to settings
      </Link>
      <PageHeader
        title="Users and roles"
        description="Super Admin only. Create accounts, assign roles, and deactivate or reactivate with a reason. Users are not deleted."
      />
      <CreateUserForm />
      <UserAdminPanel users={users} actorId={actor.id} />
    </div>
  );
}

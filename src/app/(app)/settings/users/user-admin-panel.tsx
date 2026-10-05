"use client";

import { useActionState } from "react";
import { FormField } from "@/components/shared/form-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASSIGNABLE_ROLES, roleLabel, roleSummary, type Role } from "@/lib/permissions";
import {
  createUserAction,
  setStatusAction,
  updateRolesAction,
  type UserActionState,
} from "@/app/(app)/settings/users/actions";

const initialState: UserActionState = {};

type ListedUser = {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  assignedRoles: Role[];
  effectiveRoles: Role[];
  statusReason: string | null;
  updatedAt: string;
};

function RoleChecks({ assigned, disabled }: { assigned: readonly Role[]; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-foreground">Roles</legend>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked readOnly disabled className="accent-primary" />
        Employee (every user)
      </label>
      {ASSIGNABLE_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="roles"
            value={role}
            defaultChecked={assigned.includes(role)}
            className="accent-primary"
          />
          {roleLabel(role)}
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        Manager is also applied automatically once this person has direct reports.
      </p>
    </fieldset>
  );
}

function ActionMessage({ state }: { state: UserActionState }) {
  if (state.error) {
    return <p className="text-sm text-destructive">{state.error}</p>;
  }
  if (state.ok) {
    return <p className="text-sm text-secondary">Saved.</p>;
  }
  return null;
}

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createUserAction, initialState);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-medium text-foreground">Add user</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Creates an active account on the company domain. They can sign in only after this exists.
      </p>
      <form action={action} className="mt-4 space-y-4">
        <FormField label="Name" htmlFor="new-user-name">
          <Input name="name" autoComplete="name" required />
        </FormField>
        <FormField label="Work email" htmlFor="new-user-email">
          <Input name="email" type="email" autoComplete="off" required />
        </FormField>
        <RoleChecks assigned={[]} />
        <FormField label="Reason" htmlFor="new-user-reason" hint="Stored in the audit log.">
          <Input name="reason" required />
        </FormField>
        <ActionMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Create user"}
        </Button>
      </form>
    </section>
  );
}

function UserCard({ user, isSelf }: { user: ListedUser; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(updateRolesAction, initialState);
  const [statusState, statusAction, statusPending] = useActionState(setStatusAction, initialState);
  const nextStatus = user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">{user.name}</h2>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <p className="mt-1 text-sm text-foreground">{roleSummary(user.effectiveRoles)}</p>
        </div>
        <StatusBadge status={user.status === "ACTIVE" ? "success" : "warning"}>
          {user.status === "ACTIVE" ? "Active" : "Inactive"}
        </StatusBadge>
      </div>
      {user.statusReason ? (
        <p className="mt-3 text-sm text-muted-foreground">Last status reason: {user.statusReason}</p>
      ) : null}
      {isSelf ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Another Super Admin must change your roles or status.
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form action={roleAction} className="space-y-4">
            <input type="hidden" name="userId" value={user.id} />
            <RoleChecks assigned={user.assignedRoles} />
            <FormField label="Reason for role change" htmlFor={`roles-reason-${user.id}`}>
              <Input name="reason" required />
            </FormField>
            <ActionMessage state={roleState} />
            <Button type="submit" variant="secondary" disabled={rolePending}>
              {rolePending ? "Saving…" : "Save roles"}
            </Button>
          </form>
          <form action={statusAction} className="space-y-4">
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="status" value={nextStatus} />
            <FormField
              label={user.status === "ACTIVE" ? "Reason for deactivation" : "Reason for reactivation"}
              htmlFor={`status-reason-${user.id}`}
            >
              <Input name="reason" required />
            </FormField>
            <ActionMessage state={statusState} />
            <Button
              type="submit"
              variant={user.status === "ACTIVE" ? "destructive" : "default"}
              disabled={statusPending}
            >
              {statusPending
                ? "Saving…"
                : user.status === "ACTIVE"
                  ? "Deactivate"
                  : "Reactivate"}
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}

export function UserAdminPanel({ users, actorId }: { users: ListedUser[]; actorId: string }) {
  return (
    <div className="flex flex-col gap-4">
      {users.map((user) => (
        <UserCard
          key={`${user.id}-${user.updatedAt}-${user.status}-${user.assignedRoles.join("-")}`}
          user={user}
          isSelf={user.id === actorId}
        />
      ))}
    </div>
  );
}

/**
 * Permission map for Avanza HRMS.
 * Every server action and route check goes through `can`.
 * Sidebar visibility uses the same function. Enforcement stays on the server.
 */

export const ROLES = ["SUPER_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"] as const;

export type Role = (typeof ROLES)[number];

export const ASSIGNABLE_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "MANAGER"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ACTIONS = [
  "app.view",
  "team.view",
  "people.view",
  "reports.view",
  "settings.view",
  "audit.view",
  "users.manage",
  "employee.view",
  "employee.sensitive.view",
] as const;

export type Action = (typeof ACTIONS)[number];

export type EmployeeResource = {
  type: "employee";
  id: string;
  managerId: string | null;
};

export type Resource = { type: "app" } | EmployeeResource;

export type Principal = {
  id: string;
  email: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  /** Effective roles: EMPLOYEE always, plus assigned roles and derived MANAGER. */
  roles: readonly Role[];
  directReportIds: readonly string[];
};

type PermissionRule = {
  roles: readonly Role[];
  /** Managers may act only on themselves or their direct reports. HR and Super Admin are not scoped. */
  scope?: "direct-reports";
};

export const PERMISSIONS: Record<Action, PermissionRule> = {
  "app.view": { roles: ["EMPLOYEE"] },
  "team.view": { roles: ["MANAGER", "HR_ADMIN", "SUPER_ADMIN"] },
  "people.view": { roles: ["HR_ADMIN", "SUPER_ADMIN"] },
  "reports.view": {
    roles: ["MANAGER", "HR_ADMIN", "SUPER_ADMIN"],
    scope: "direct-reports",
  },
  "settings.view": { roles: ["HR_ADMIN", "SUPER_ADMIN"] },
  "audit.view": { roles: ["HR_ADMIN", "SUPER_ADMIN"] },
  "users.manage": { roles: ["SUPER_ADMIN"] },
  "employee.view": {
    roles: ["EMPLOYEE", "MANAGER", "HR_ADMIN", "SUPER_ADMIN"],
    scope: "direct-reports",
  },
  "employee.sensitive.view": { roles: ["HR_ADMIN"] },
};

/** Longer prefixes first so `/settings/users` does not match `/settings` only. */
export const ROUTE_GUARDS: readonly { prefix: string; action: Action }[] = [
  { prefix: "/settings/users", action: "users.manage" },
  { prefix: "/settings/audit-log", action: "audit.view" },
  { prefix: "/settings", action: "settings.view" },
  { prefix: "/people", action: "people.view" },
  { prefix: "/my-team", action: "team.view" },
  { prefix: "/reports", action: "reports.view" },
];

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_ADMIN: "HR Admin",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export function roleSummary(roles: readonly Role[]): string {
  const visible = roles.filter((role) => role !== "EMPLOYEE" || roles.length === 1);
  return visible.map(roleLabel).join(" · ");
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Every user is an employee. MANAGER is explicit, or derived when the person
 * has at least one current direct report.
 */
export function effectiveRoles(input: {
  assignedRoles: readonly string[];
  directReportCount: number;
}): Role[] {
  const assigned = new Set<Role>();
  for (const role of input.assignedRoles) {
    if (isRole(role)) {
      assigned.add(role);
    }
  }
  assigned.add("EMPLOYEE");
  if (input.directReportCount > 0) {
    assigned.add("MANAGER");
  }
  return ROLES.filter((role) => assigned.has(role));
}

export function normalizeAssignedRoles(roles: readonly string[]): Role[] {
  const selected = new Set<Role>(["EMPLOYEE"]);
  for (const role of roles) {
    if (!isRole(role)) {
      throw new Error("Unknown role.");
    }
    selected.add(role);
  }
  return ROLES.filter((role) => selected.has(role));
}

export function buildPrincipal(input: {
  id: string;
  email?: string;
  name?: string;
  status?: "ACTIVE" | "INACTIVE";
  assignedRoles: readonly string[];
  directReportIds?: readonly string[];
}): Principal {
  const directReportIds = input.directReportIds ?? [];
  return {
    id: input.id,
    email: input.email ?? "",
    name: input.name ?? "",
    status: input.status ?? "ACTIVE",
    roles: effectiveRoles({
      assignedRoles: input.assignedRoles,
      directReportCount: directReportIds.length,
    }),
    directReportIds,
  };
}

function hasAnyRole(user: Principal, roles: readonly Role[]): boolean {
  return roles.some((role) => user.roles.includes(role));
}

function isUnscopedAdmin(user: Principal, rule: PermissionRule): boolean {
  if (user.roles.includes("SUPER_ADMIN") && rule.roles.includes("SUPER_ADMIN")) {
    return true;
  }
  return user.roles.includes("HR_ADMIN") && rule.roles.includes("HR_ADMIN");
}

function managesEmployee(user: Principal, resource: EmployeeResource): boolean {
  return resource.managerId === user.id || user.directReportIds.includes(resource.id);
}

export function can(
  user: Principal | null,
  action: Action,
  resource: Resource = { type: "app" },
): boolean {
  if (!user || user.status !== "ACTIVE") {
    return false;
  }

  const rule = PERMISSIONS[action];
  if (!hasAnyRole(user, rule.roles)) {
    return false;
  }
  if (rule.scope !== "direct-reports") {
    return true;
  }
  if (isUnscopedAdmin(user, rule)) {
    return true;
  }
  if (resource.type !== "employee") {
    return true;
  }
  if (resource.id === user.id) {
    return true;
  }
  return user.roles.includes("MANAGER") && managesEmployee(user, resource);
}

export function guardForPath(pathname: string): Action | null {
  const path = pathname.split("?")[0] ?? pathname;
  const match = ROUTE_GUARDS.find(
    (guard) => path === guard.prefix || path.startsWith(`${guard.prefix}/`),
  );
  return match?.action ?? null;
}

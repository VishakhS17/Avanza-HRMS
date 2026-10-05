import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  buildPrincipal,
  can,
  effectiveRoles,
  normalizeAssignedRoles,
  type Role,
} from "@/lib/permissions";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { allowedEmailDomain, isCompanyEmail, normalizeEmail } from "@/lib/services/auth-policy";

export class UserAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserAdminError";
  }
}

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ListedUser = {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "INACTIVE";
  assignedRoles: Role[];
  effectiveRoles: Role[];
  directReportIds: string[];
  statusReason: string | null;
  updatedAt: string;
};

/**
 * Employee records are added in a later step. Until then nobody has direct reports,
 * and the manager role comes only from explicit assignment.
 */
export async function listDirectReportIds(managerUserId: string): Promise<string[]> {
  void managerUserId;
  return [];
}

function requiredName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 120) {
    throw new UserAdminError("Enter a name up to 120 characters.");
  }
  return name;
}

function requiredReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3) {
    throw new UserAdminError("A reason of at least 3 characters is required.");
  }
  if (reason.length > 500) {
    throw new UserAdminError("Reason must be 500 characters or fewer.");
  }
  return reason;
}

function requiredCompanyEmail(value: string): string {
  const email = normalizeEmail(value);
  if (!isCompanyEmail(email, allowedEmailDomain())) {
    throw new UserAdminError("Email must belong to the company domain.");
  }
  return email;
}

function sameRoles(left: readonly Role[], right: readonly Role[]): boolean {
  return left.join("|") === right.join("|");
}

async function requireSuperAdmin(actorId: string) {
  const actor = await getDb().user.findUnique({ where: { id: actorId } });
  if (!actor) {
    throw new UserAdminError("You cannot manage users.");
  }
  const principal = buildPrincipal({
    id: actor.id,
    email: actor.email,
    name: actor.name,
    status: actor.status,
    assignedRoles: actor.roles,
  });
  if (!can(principal, "users.manage")) {
    throw new UserAdminError("You cannot manage users.");
  }
  return principal;
}

async function assertKeepsActiveSuperAdmin(
  userId: string,
  nextRoles: readonly Role[],
  nextStatus: "ACTIVE" | "INACTIVE",
) {
  if (nextStatus === "ACTIVE" && nextRoles.includes("SUPER_ADMIN")) {
    return;
  }
  const others = await getDb().user.count({
    where: {
      id: { not: userId },
      status: "ACTIVE",
      roles: { has: "SUPER_ADMIN" },
    },
  });
  if (others === 0) {
    throw new UserAdminError("The last active Super Admin cannot be demoted or deactivated.");
  }
}

function rethrowKnown(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new UserAdminError("A user with that email already exists.");
  }
  throw error;
}

export async function listUsers(): Promise<ListedUser[]> {
  const users = await getDb().user.findMany({
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  const listed: ListedUser[] = [];
  for (const user of users) {
    const directReportIds = await listDirectReportIds(user.id);
    listed.push({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      assignedRoles: normalizeAssignedRoles(user.roles),
      effectiveRoles: effectiveRoles({
        assignedRoles: user.roles,
        directReportCount: directReportIds.length,
      }),
      directReportIds,
      statusReason: user.statusReason,
      updatedAt: user.updatedAt.toISOString(),
    });
  }
  return listed;
}

export async function createUser(input: {
  actorId: string;
  name: string;
  email: string;
  assignedRoles: readonly string[];
  reason: string;
  meta?: AuditMeta;
}) {
  const actor = await requireSuperAdmin(input.actorId);
  const name = requiredName(input.name);
  const email = requiredCompanyEmail(input.email);
  const roles = normalizeAssignedRoles(input.assignedRoles);
  const reason = requiredReason(input.reason);
  await assertKeepsActiveSuperAdmin("new-user", roles, "ACTIVE");

  try {
    return await getDb().$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, status: "ACTIVE", roles },
      });
      await audit.log(
        {
          actor: actor.id,
          action: AUDIT_ACTIONS.USER_CREATED,
          entityType: "User",
          entityId: user.id,
          before: null,
          after: { name, email, status: "ACTIVE", roles },
          reason,
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      return user;
    });
  } catch (error) {
    rethrowKnown(error);
  }
}

export async function updateUserRoles(input: {
  actorId: string;
  userId: string;
  assignedRoles: readonly string[];
  reason: string;
  meta?: AuditMeta;
}) {
  const actor = await requireSuperAdmin(input.actorId);
  if (actor.id === input.userId) {
    throw new UserAdminError("You cannot change your own roles.");
  }
  const reason = requiredReason(input.reason);
  const roles = normalizeAssignedRoles(input.assignedRoles);
  const target = await getDb().user.findUnique({ where: { id: input.userId } });
  if (!target) {
    throw new UserAdminError("User not found.");
  }
  const previous = normalizeAssignedRoles(target.roles);
  if (sameRoles(previous, roles)) {
    return target;
  }
  await assertKeepsActiveSuperAdmin(target.id, roles, target.status);

  return getDb().$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: target.id },
      data: { roles },
    });
    await audit.log(
      {
        actor: actor.id,
        action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
        entityType: "User",
        entityId: user.id,
        before: { roles: previous, status: target.status },
        after: { roles, status: user.status },
        reason,
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    return user;
  });
}

export async function setUserStatus(input: {
  actorId: string;
  userId: string;
  status: "ACTIVE" | "INACTIVE";
  reason: string;
  meta?: AuditMeta;
}) {
  const actor = await requireSuperAdmin(input.actorId);
  if (actor.id === input.userId) {
    throw new UserAdminError("You cannot change your own status.");
  }
  if (input.status !== "ACTIVE" && input.status !== "INACTIVE") {
    throw new UserAdminError("Unknown status.");
  }
  const reason = requiredReason(input.reason);
  const target = await getDb().user.findUnique({ where: { id: input.userId } });
  if (!target) {
    throw new UserAdminError("User not found.");
  }
  if (target.status === input.status) {
    throw new UserAdminError(
      input.status === "ACTIVE" ? "This user is already active." : "This user is already deactivated.",
    );
  }
  const roles = normalizeAssignedRoles(target.roles);
  await assertKeepsActiveSuperAdmin(target.id, roles, input.status);

  return getDb().$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: target.id },
      data: {
        status: input.status,
        statusReason: reason,
        statusChangedAt: new Date(),
      },
    });
    if (input.status === "INACTIVE") {
      await tx.session.deleteMany({ where: { userId: user.id } });
    }
    await audit.log(
      {
        actor: actor.id,
        action:
          input.status === "INACTIVE"
            ? AUDIT_ACTIONS.USER_DEACTIVATED
            : AUDIT_ACTIONS.USER_REACTIVATED,
        entityType: "User",
        entityId: user.id,
        before: { status: target.status, roles },
        after: { status: user.status, roles },
        reason,
        ipAddress: input.meta?.ipAddress,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    return user;
  });
}

export async function ensureBootstrapAdmin(): Promise<string> {
  const email = normalizeEmail(process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL);
  const name = process.env.AUTH_BOOTSTRAP_ADMIN_NAME?.trim() || "Super Admin";
  if (!email) {
    return "AUTH_BOOTSTRAP_ADMIN_EMAIL is not set. No user was created.";
  }
  if (!isCompanyEmail(email, allowedEmailDomain())) {
    throw new Error("AUTH_BOOTSTRAP_ADMIN_EMAIL must use AUTH_ALLOWED_EMAIL_DOMAIN.");
  }

  const existing = await getDb().user.findUnique({ where: { email } });
  if (existing) {
    return `Bootstrap admin already exists (${email}). Roles were left unchanged.`;
  }

  const roles: Role[] = ["SUPER_ADMIN", "EMPLOYEE"];
  await getDb().$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, status: "ACTIVE", roles },
    });
    await audit.log(
      {
        actor: null,
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: "User",
        entityId: user.id,
        before: null,
        after: { name, email, status: "ACTIVE", roles },
        reason: "Bootstrap super admin",
      },
      tx,
    );
  });
  return `Created bootstrap super admin ${email}.`;
}

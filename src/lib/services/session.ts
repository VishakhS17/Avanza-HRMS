import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { buildPrincipal, type Principal, type Role } from "@/lib/permissions";
import { listDirectReportIds } from "@/lib/services/users";

/** Absolute cap for a session that stays active. Idle timeout is shorter. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ADMIN_IDLE_FALLBACK_MINUTES = 15;
const STANDARD_IDLE_FALLBACK_MINUTES = 8 * 60;

export type SessionBlockReason = "inactive" | "expired" | "idle";

export function idleTimeoutMs(roles: readonly Role[], env: NodeJS.ProcessEnv = process.env): number {
  const admin = roles.includes("SUPER_ADMIN") || roles.includes("HR_ADMIN");
  const key = admin ? "AUTH_ADMIN_IDLE_TIMEOUT_MINUTES" : "AUTH_IDLE_TIMEOUT_MINUTES";
  const fallback = admin ? ADMIN_IDLE_FALLBACK_MINUTES : STANDARD_IDLE_FALLBACK_MINUTES;
  const parsed = Number(env[key]);
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return minutes * 60 * 1000;
}

/** Why a database session must be rejected. Null means the request may continue. */
export function sessionBlockReason(input: {
  status: "ACTIVE" | "INACTIVE";
  expires: Date;
  lastActiveAt: Date;
  now: Date;
  idleTimeoutMs: number;
}): SessionBlockReason | null {
  if (input.status !== "ACTIVE") {
    return "inactive";
  }
  if (input.expires.getTime() <= input.now.getTime()) {
    return "expired";
  }
  if (input.now.getTime() - input.lastActiveAt.getTime() > input.idleTimeoutMs) {
    return "idle";
  }
  return null;
}

export function sessionUsesSecureCookie(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AUTH_URL ?? "http://localhost:3000").startsWith("https://");
}

export function sessionCookieName(env: NodeJS.ProcessEnv = process.env): string {
  return sessionUsesSecureCookie(env) ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export function sessionCookieOptions(expires: Date, env: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: sessionUsesSecureCookie(env),
    expires,
  };
}

export function newSessionFields(userId: string, now = new Date()) {
  return {
    sessionToken: randomBytes(32).toString("base64url"),
    userId,
    expires: new Date(now.getTime() + SESSION_MAX_AGE_MS),
    lastActiveAt: now,
  };
}

export async function createDatabaseSession(userId: string, now = new Date()) {
  const data = newSessionFields(userId, now);
  await getDb().session.create({ data });
  return data;
}

export type SessionAuthResult =
  | { ok: true; user: Principal }
  | { ok: false; reason: "missing" | SessionBlockReason };

/**
 * Loads the session and the user from the database.
 * An inactive user is rejected here, so deactivation applies on the next request.
 */
export async function authorizeSessionToken(
  sessionToken: string,
  now = new Date(),
): Promise<SessionAuthResult> {
  if (!sessionToken) {
    return { ok: false, reason: "missing" };
  }

  const session = await getDb().session.findUnique({
    where: { sessionToken },
    include: { user: true },
  });
  if (!session) {
    return { ok: false, reason: "missing" };
  }

  const directReportIds = await listDirectReportIds(session.userId);
  const principal = buildPrincipal({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    status: session.user.status,
    assignedRoles: session.user.roles,
    directReportIds,
  });
  const reason = sessionBlockReason({
    status: session.user.status,
    expires: session.expires,
    lastActiveAt: session.lastActiveAt,
    now,
    idleTimeoutMs: idleTimeoutMs(principal.roles),
  });

  if (reason) {
    await getDb().session.deleteMany({ where: { sessionToken } });
    return { ok: false, reason };
  }

  if (now.getTime() - session.lastActiveAt.getTime() > 60_000) {
    await getDb().session.update({
      where: { id: session.id },
      data: {
        lastActiveAt: now,
        expires: new Date(now.getTime() + SESSION_MAX_AGE_MS),
      },
    });
  }

  return { ok: true, user: principal };
}

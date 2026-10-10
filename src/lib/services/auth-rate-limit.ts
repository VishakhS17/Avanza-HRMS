import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { normalizeEmail } from "@/lib/services/auth-policy";
import { readRequestMeta } from "@/lib/request-meta";

/** Attempts inside this window. It starts at the first attempt and does not slide. */
export const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
/** Sign-in attempts per IP and per email. The attempt that reaches the limit is refused. */
export const SIGN_IN_LIMIT = 5;
/** Requests to `/api/auth` per IP. One OAuth sign-in uses several of these. */
export const AUTH_ROUTE_LIMIT = 60;

const GENERIC_ROUTE_ERROR = "Sign-in was not accepted.";

export type RateLimitDecision = { allowed: true } | { allowed: false; justLocked: boolean };

type LimitRow = { key: string; windowStart: Date; count: number };

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Increments each key in one transaction. A key already at the limit is not incremented,
 * and neither are the keys checked with it. The window stays put until it expires.
 */
export async function consumeAuthRateLimit(input: {
  keys: readonly string[];
  limit: number;
  now?: Date;
  windowMs?: number;
}): Promise<RateLimitDecision> {
  const keys = [...new Set(input.keys.map((key) => key.trim()).filter(Boolean))].sort();
  if (keys.length === 0) return { allowed: true };
  const now = input.now ?? new Date();
  const windowMs = input.windowMs ?? AUTH_RATE_WINDOW_MS;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getDb().$transaction((tx) => applyLimit(tx, keys, input.limit, now, windowMs));
    } catch (error) {
      if (attempt === 0 && isUniqueConflict(error)) continue;
      throw error;
    }
  }
  return { allowed: false, justLocked: false };
}

async function applyLimit(
  tx: Prisma.TransactionClient,
  keys: string[],
  limit: number,
  now: Date,
  windowMs: number,
): Promise<RateLimitDecision> {
  const rows = new Map<string, LimitRow>();
  for (const key of keys) {
    const found = await tx.$queryRaw<LimitRow[]>`
      SELECT key, "windowStart", count
      FROM auth_rate_limits
      WHERE key = ${key}
      FOR UPDATE
    `;
    const row = found[0];
    if (row) rows.set(key, { key: row.key, windowStart: asDate(row.windowStart), count: Number(row.count) });
  }

  const open = keys.map((key) => {
    const row = rows.get(key);
    const expired = !row || now.getTime() - row.windowStart.getTime() >= windowMs;
    return {
      key,
      exists: Boolean(row),
      expired,
      count: expired || !row ? 0 : row.count,
      windowStart: expired || !row ? now : row.windowStart,
    };
  });

  if (open.some((row) => row.count >= limit)) {
    return { allowed: false, justLocked: false };
  }

  let justLocked = false;
  for (const row of open) {
    const count = row.count + 1;
    if (count >= limit) justLocked = true;
    if (!row.exists) {
      await tx.authRateLimit.create({ data: { key: row.key, windowStart: row.windowStart, count } });
    } else {
      await tx.authRateLimit.update({
        where: { key: row.key },
        data: { windowStart: row.windowStart, count },
      });
    }
  }
  return justLocked ? { allowed: false, justLocked: true } : { allowed: true };
}

async function writeLockout(input: {
  actorId: string | null;
  email: string;
  entityId: string;
  scope: "sign-in" | "auth-route";
  ipAddress: string | null;
  userAgent: string | null;
}) {
  await audit.log({
    actor: input.actorId,
    action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED,
    entityType: input.scope === "sign-in" ? "User" : "AuthRoute",
    entityId: input.entityId,
    reason: "Repeated sign-in attempts",
    after: { email: input.email || null, scope: input.scope },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
}

/** True when this sign-in attempt may continue. A lockout writes one summary audit row, then stays quiet. */
export async function allowSignInAttempt(input: {
  ipAddress: string | null;
  email: string;
  actorId?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<boolean> {
  const email = normalizeEmail(input.email);
  const keys = [
    input.ipAddress ? `signin:ip:${input.ipAddress}` : "",
    email ? `signin:email:${email}` : "",
  ];
  const decision = await consumeAuthRateLimit({ keys, limit: SIGN_IN_LIMIT, now: input.now });
  if (decision.allowed) return true;
  if (decision.justLocked) {
    await writeLockout({
      actorId: input.actorId ?? null,
      email,
      entityId: input.actorId ?? (email || "unknown"),
      scope: "sign-in",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent ?? null,
    });
  }
  return false;
}

/** Limits `/api/auth` by IP. Returns a generic 429 once the window is full, otherwise null. */
export async function authRouteLimitResponse(request: Request): Promise<Response | null> {
  const meta = readRequestMeta(request.headers);
  if (!meta.ipAddress) return null;
  const decision = await consumeAuthRateLimit({
    keys: [`route:ip:${meta.ipAddress}`],
    limit: AUTH_ROUTE_LIMIT,
  });
  if (decision.allowed) return null;
  if (decision.justLocked) {
    await writeLockout({
      actorId: null,
      email: "",
      entityId: "auth-route",
      scope: "auth-route",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
  return Response.json(
    { error: GENERIC_ROUTE_ERROR },
    { status: 429, headers: { "Cache-Control": "no-store" } },
  );
}

"use server";

import { cookies, headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getDb } from "@/lib/db";
import { readRequestMeta } from "@/lib/request-meta";
import { signOut } from "@/lib/auth";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import {
  allowedEmailDomain,
  evaluateSignIn,
  isDevLoginEnabled,
  normalizeEmail,
  secretsMatch,
} from "@/lib/services/auth-policy";
import { allowSignInAttempt } from "@/lib/services/auth-rate-limit";
import { newSessionFields, sessionCookieName, sessionCookieOptions } from "@/lib/services/session";

const DEV_LOGIN_FAILURE =
  "Those credentials were not accepted. The account must already exist, be active, and use the company email domain.";

export type DevSignInState = {
  error?: string;
};

async function recordFailedDevLogin(email: string, reason: string, userId: string | null) {
  const meta = readRequestMeta(await headers());
  await audit.log({
    actor: userId,
    action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
    entityType: "User",
    entityId: userId ?? (email || "unknown"),
    reason,
    after: { email, provider: "dev-credentials" },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function devSignIn(
  _previous: DevSignInState,
  formData: FormData,
): Promise<DevSignInState> {
  try {
    if (!isDevLoginEnabled()) {
      return { error: "Development login is disabled." };
    }

    const email = normalizeEmail(String(formData.get("email") ?? ""));
    const password = String(formData.get("password") ?? "");
    const meta = readRequestMeta(await headers());
    const allowed = await allowSignInAttempt({
      ipAddress: meta.ipAddress,
      email,
      userAgent: meta.userAgent,
    });
    if (!allowed) return { error: DEV_LOGIN_FAILURE };

    const expected = process.env.AUTH_DEV_PASSWORD ?? "";
    if (!expected || !secretsMatch(password, expected)) {
      await recordFailedDevLogin(email, "invalid-credentials", null);
      return { error: DEV_LOGIN_FAILURE };
    }

    const user = email
      ? await getDb().user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        })
      : null;
    const decision = evaluateSignIn({
      email,
      emailVerified: null,
      allowedDomain: allowedEmailDomain(),
      user: user ? { status: user.status } : null,
      devPassword: true,
    });
    if (!decision.ok || !user) {
      await recordFailedDevLogin(email, decision.ok ? "unknown-user" : decision.reason, user?.id ?? null);
      return { error: DEV_LOGIN_FAILURE };
    }

    const session = newSessionFields(user.id);
    await getDb().$transaction(async (tx) => {
      await tx.session.create({ data: session });
      await audit.log(
        {
          actor: user.id,
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          entityType: "User",
          entityId: user.id,
          after: { email: user.email, provider: "dev-credentials" },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        tx,
      );
    });

    (await cookies()).set(sessionCookieName(), session.sessionToken, sessionCookieOptions(session.expires));
    redirect("/");
  } catch (error) {
    unstable_rethrow(error);
    console.error("Dev sign-in failed", error);
    return { error: "Could not sign in. Check that the database is running." };
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

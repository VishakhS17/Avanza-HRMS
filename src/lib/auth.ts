import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import type { Provider } from "next-auth/providers";
import { getDb } from "@/lib/db";
import { readRequestMeta } from "@/lib/request-meta";
import { createAuthAdapter } from "@/lib/auth-adapter";
import { AUDIT_ACTIONS, audit } from "@/lib/services/audit";
import { companyTenantIssuer, allowedEmailDomain, evaluateSignIn, normalizeEmail } from "@/lib/services/auth-policy";
import { allowSignInAttempt } from "@/lib/services/auth-rate-limit";
import { SESSION_MAX_AGE_MS, sessionCookieName, sessionUsesSecureCookie } from "@/lib/services/session";

function emailVerifiedFlag(profile: unknown): boolean | null {
  if (!profile || typeof profile !== "object" || !("email_verified" in profile)) {
    return null;
  }
  const value = (profile as { email_verified?: unknown }).email_verified;
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function configuredProviders(domain: string): Provider[] {
  const providers: Provider[] = [];
  const googleId = process.env.AUTH_GOOGLE_ID;
  const googleSecret = process.env.AUTH_GOOGLE_SECRET;
  if (googleId && googleSecret) {
    providers.push(
      Google({
        clientId: googleId,
        clientSecret: googleSecret,
        allowDangerousEmailAccountLinking: true,
        authorization: {
          params: {
            prompt: "select_account",
            ...(domain ? { hd: domain } : {}),
          },
        },
      }),
    );
  }

  const microsoftId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const microsoftSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  const issuer = companyTenantIssuer();
  if (microsoftId && microsoftSecret && issuer) {
    providers.push(
      MicrosoftEntraID({
        clientId: microsoftId,
        clientSecret: microsoftSecret,
        issuer,
        allowDangerousEmailAccountLinking: true,
        profile(profile) {
          const raw = profile.email || profile.preferred_username || "";
          const email = raw.includes("@") ? raw.toLowerCase() : undefined;
          return {
            id: profile.sub,
            name: profile.name,
            email,
            image: null,
          };
        },
      }),
    );
  }

  return providers;
}

export function oauthProviderFlags() {
  return {
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    microsoft: Boolean(
      process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
        process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
        companyTenantIssuer(),
    ),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth((req) => {
  const meta = readRequestMeta(req?.headers);
  const domain = allowedEmailDomain();

  return {
    adapter: createAuthAdapter(),
    providers: configuredProviders(domain),
    session: {
      strategy: "database",
      maxAge: SESSION_MAX_AGE_MS / 1000,
    },
    pages: {
      signIn: "/login",
      error: "/login",
    },
    cookies: {
      sessionToken: {
        name: sessionCookieName(),
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: sessionUsesSecureCookie(),
        },
      },
    },
    trustHost: true,
    callbacks: {
      async signIn({ user, profile, account }) {
        const email = normalizeEmail(user.email);
        const existing = email
          ? await getDb().user.findFirst({
              where: { email: { equals: email, mode: "insensitive" } },
            })
          : null;
        const allowed = await allowSignInAttempt({
          ipAddress: meta.ipAddress,
          email,
          actorId: existing?.id ?? null,
          userAgent: meta.userAgent,
        });
        if (!allowed) return false;
        const decision = evaluateSignIn({
          email,
          emailVerified: emailVerifiedFlag(profile),
          allowedDomain: domain,
          user: existing ? { status: existing.status } : null,
        });
        if (!decision.ok) {
          await audit.log({
            actor: existing?.id ?? null,
            action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
            entityType: "User",
            entityId: existing?.id ?? (email || "unknown"),
            reason: decision.reason,
            after: { email, provider: account?.provider ?? null },
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          });
          return false;
        }
        return true;
      },
    },
    events: {
      async signIn({ user, account }) {
        const email = normalizeEmail(user.email);
        const row =
          (user.id ? await getDb().user.findUnique({ where: { id: user.id } }) : null) ??
          (email
            ? await getDb().user.findFirst({
                where: { email: { equals: email, mode: "insensitive" } },
              })
            : null);
        if (!row) {
          return;
        }
        await audit.log({
          actor: row.id,
          action: AUDIT_ACTIONS.AUTH_LOGIN,
          entityType: "User",
          entityId: row.id,
          after: { email: row.email, provider: account?.provider ?? null },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      },
      async signOut(message) {
        if (!("session" in message) || !message.session?.userId) {
          return;
        }
        const userId = message.session.userId;
        await audit.log({
          actor: userId,
          action: AUDIT_ACTIONS.AUTH_LOGOUT,
          entityType: "User",
          entityId: userId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      },
    },
  };
});

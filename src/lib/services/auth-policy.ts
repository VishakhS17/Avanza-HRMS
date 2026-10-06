import { createHash, timingSafeEqual } from "node:crypto";

export type SignInRejection =
  | "missing-email"
  | "unverified-email"
  | "wrong-domain"
  | "unknown-user"
  | "inactive";

export type SignInDecision = { ok: true } | { ok: false; reason: SignInRejection };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function allowedEmailDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AUTH_ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase().replace(/^@/, "");
}

export function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isCompanyEmail(email: string, allowedDomain: string): boolean {
  const domain = allowedDomain.trim().toLowerCase().replace(/^@/, "");
  const normalized = normalizeEmail(email);
  if (!domain || !EMAIL_PATTERN.test(normalized)) {
    return false;
  }
  const at = normalized.lastIndexOf("@");
  return normalized.slice(at + 1) === domain;
}

/**
 * Sign-in is allowed only for an existing ACTIVE user on the company domain.
 * Returning ok does not create a user.
 */
export function evaluateSignIn(input: {
  email: string | null | undefined;
  emailVerified: boolean | null;
  allowedDomain: string;
  user: { status: "ACTIVE" | "INACTIVE" } | null;
}): SignInDecision {
  const email = normalizeEmail(input.email);
  if (!email) {
    return { ok: false, reason: "missing-email" };
  }
  if (input.emailVerified === false) {
    return { ok: false, reason: "unverified-email" };
  }
  if (!isCompanyEmail(email, input.allowedDomain)) {
    return { ok: false, reason: "wrong-domain" };
  }
  if (!input.user) {
    return { ok: false, reason: "unknown-user" };
  }
  if (input.user.status !== "ACTIVE") {
    return { ok: false, reason: "inactive" };
  }
  return { ok: true };
}

/** Shared password login. On when the flag is true and a password is set, including production. */
export function isDevLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_DEV_LOGIN === "true" && Boolean(env.AUTH_DEV_PASSWORD);
}

export function secretsMatch(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

/** Auth.js adapter hook. SSO must not insert a User row. */
export function rejectSelfSignup(): never {
  throw new Error("Self-signup is disabled. HR must create an active user before sign-in.");
}

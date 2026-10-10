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

const COMMON_MICROSOFT_TENANTS = new Set(["common", "organizations", "consumers"]);
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Microsoft sign-in is allowed only for one company tenant.
 * `common`, `organizations`, and `consumers` accept accounts outside that tenant.
 */
export function isCompanyTenantIssuer(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (
    host !== "login.microsoftonline.com" &&
    host !== "login.microsoftonline.us" &&
    host !== "login.partner.microsoftonline.cn"
  ) {
    return false;
  }
  const tenant = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!tenant || COMMON_MICROSOFT_TENANTS.has(tenant.toLowerCase())) return false;
  return TENANT_ID.test(tenant);
}

export function companyTenantIssuer(env: NodeJS.ProcessEnv = process.env): string | null {
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.trim() ?? "";
  return issuer && isCompanyTenantIssuer(issuer) ? issuer : null;
}

/**
 * Sign-in is allowed only for an existing ACTIVE user on the company domain.
 * Returning ok does not create a user. OAuth also requires email_verified.
 */
export function evaluateSignIn(input: {
  email: string | null | undefined;
  emailVerified: boolean | null;
  allowedDomain: string;
  user: { status: "ACTIVE" | "INACTIVE" } | null;
  /** The shared dev password. It is not an identity-provider assertion. */
  devPassword?: boolean;
}): SignInDecision {
  const email = normalizeEmail(input.email);
  if (!email) {
    return { ok: false, reason: "missing-email" };
  }
  // OAuth must prove the address. A missing claim is not verified.
  // The dev password form is not an OAuth assertion and skips this check.
  if (!input.devPassword && input.emailVerified !== true) {
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

/**
 * Shared password login for local development.
 * Production always returns false, even if AUTH_DEV_LOGIN and AUTH_DEV_PASSWORD are set.
 */
export function isDevLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
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

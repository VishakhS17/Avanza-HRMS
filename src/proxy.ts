import { NextResponse, type NextRequest } from "next/server";
import { can, guardForPath } from "@/lib/permissions";
import { applySecurityHeaders, contentSecurityPolicy } from "@/lib/security-headers";
import { authorizeSessionToken, sessionCookieName } from "@/lib/services/session";

function isPublic(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/api/auth");
}

function refusesWithStatus(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/settings/audit-log/export") ||
    pathname.startsWith("/reports/export")
  );
}

function withRequestCsp(request: NextRequest, csp: string, nonce: string): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  return headers;
}

function secure(response: NextResponse, csp: string): NextResponse {
  applySecurityHeaders(response.headers, {
    csp,
    production: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
  });
  const requestHeaders = withRequestCsp(request, csp, nonce);
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return secure(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  }

  const token = request.cookies.get(sessionCookieName())?.value;
  const result = token
    ? await authorizeSessionToken(token)
    : { ok: false as const, reason: "missing" as const };

  if (!result.ok) {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.set(sessionCookieName(), "", { path: "/", maxAge: 0 });
      return secure(response, csp);
    }
    const url = new URL("/login", request.url);
    if (result.reason !== "missing") {
      url.searchParams.set("error", result.reason);
    }
    const response = NextResponse.redirect(url);
    response.cookies.set(sessionCookieName(), "", { path: "/", maxAge: 0 });
    return secure(response, csp);
  }

  const action = guardForPath(pathname);
  if (action && !can(result.user, action)) {
    if (refusesWithStatus(pathname)) {
      return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }), csp);
    }
    return secure(NextResponse.redirect(new URL("/forbidden", request.url)), csp);
  }

  return secure(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

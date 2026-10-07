import { NextResponse, type NextRequest } from "next/server";
import { can, guardForPath } from "@/lib/permissions";
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(sessionCookieName())?.value;
  const result = token
    ? await authorizeSessionToken(token)
    : { ok: false as const, reason: "missing" as const };

  if (!result.ok) {
    const url = new URL("/login", request.url);
    if (result.reason !== "missing") {
      url.searchParams.set("error", result.reason);
    }
    const response = NextResponse.redirect(url);
    response.cookies.set(sessionCookieName(), "", { path: "/", maxAge: 0 });
    return response;
  }

  const action = guardForPath(pathname);
  if (action && !can(result.user, action)) {
    if (refusesWithStatus(pathname)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Action, type Principal, type Resource } from "@/lib/permissions";
import { authorizeSessionToken, sessionCookieName } from "@/lib/services/session";

export const getCurrentUser = cache(async (): Promise<Principal | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) {
    return null;
  }
  const result = await authorizeSessionToken(token);
  return result.ok ? result.user : null;
});

export async function requireUser(): Promise<Principal> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireCan(action: Action, resource?: Resource): Promise<Principal> {
  const user = await requireUser();
  if (!can(user, action, resource)) {
    redirect("/forbidden");
  }
  return user;
}

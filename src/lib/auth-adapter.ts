import type { Adapter, AdapterUser } from "next-auth/adapters";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { getDb } from "@/lib/db";
import { rejectSelfSignup } from "@/lib/services/auth-policy";

export function createAuthAdapter(): Adapter {
  const base = PrismaAdapter(getDb() as never);
  return {
    ...base,
    async createUser() {
      rejectSelfSignup();
    },
    async deleteUser() {
      throw new Error("Users are not hard-deleted.");
    },
    async getUserByEmail(email) {
      const user = await getDb().user.findFirst({
        where: { email: { equals: email.toLowerCase(), mode: "insensitive" } },
      });
      return (user as AdapterUser | null) ?? null;
    },
    async updateSession(session) {
      if (!base.updateSession || !session.sessionToken) return null;
      const existing = await getDb().session.findUnique({
        where: { sessionToken: session.sessionToken },
        select: { expires: true },
      });
      if (!existing) return null;
      return base.updateSession({ ...session, expires: existing.expires });
    },
    async updateUser({ id, ...data }) {
      const updated = await getDb().user.update({
        where: { id },
        data: {
          ...(data.image !== undefined ? { image: data.image } : {}),
          ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
        },
      });
      return updated as AdapterUser;
    },
  };
}

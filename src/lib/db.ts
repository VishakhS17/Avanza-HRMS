import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireDatabaseUrl } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Insert-only guard. The migration also revokes UPDATE and DELETE from the app role.
const auditMutations: ReadonlySet<string> = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "deleteManyAndReturn",
  "upsert",
]);

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaPg({ connectionString: requireDatabaseUrl() });
    const client = new PrismaClient({ adapter }).$extends({
      query: {
        auditLog: {
          async $allOperations({ operation, args, query }) {
            if (auditMutations.has(operation)) {
              throw new Error("Audit log is append-only.");
            }
            return query(args);
          },
        },
      },
    });
    globalForPrisma.prisma = client as unknown as PrismaClient;
  }

  return globalForPrisma.prisma;
}

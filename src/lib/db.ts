import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireDatabaseUrl } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Insert-only guard for audit_log, attendance_events, document_versions, and
// document_acknowledgements. The migrations also revoke UPDATE and DELETE from the app role.
const appendOnlyMutations: ReadonlySet<string> = new Set([
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
            if (appendOnlyMutations.has(operation)) {
              throw new Error("Audit log is append-only.");
            }
            return query(args);
          },
        },
        attendanceEvent: {
          async $allOperations({ operation, args, query }) {
            if (appendOnlyMutations.has(operation)) {
              throw new Error("Attendance punches are append-only.");
            }
            return query(args);
          },
        },
        documentVersion: {
          async $allOperations({ operation, args, query }) {
            if (appendOnlyMutations.has(operation)) {
              throw new Error("Document versions are append-only.");
            }
            return query(args);
          },
        },
        documentAcknowledgement: {
          async $allOperations({ operation, args, query }) {
            if (appendOnlyMutations.has(operation)) {
              throw new Error("Document acknowledgements are append-only.");
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

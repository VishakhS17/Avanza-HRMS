import { can } from "@/lib/permissions";
import { getCurrentUser, requireCan } from "@/lib/services/current-user";

/** Page gate for the audit log viewer. Super Admin and HR Admin only. */
export async function assertCanViewAuditLog(): Promise<void> {
  await requireCan("audit.view");
}

/** API gate. Returns a 403 response when the caller cannot view the audit log. */
export async function forbidUnlessAuditViewer(): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!can(user, "audit.view")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

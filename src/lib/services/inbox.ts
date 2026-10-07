import { getDb } from "@/lib/db";
import { REGULARIZATION_APPROVAL, decideRegularization } from "@/lib/services/attendance";
import { decideLeaveApproval } from "@/lib/services/leave";
import { LeaveError } from "@/lib/services/leave-errors";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** One entry point for the shared inbox. Each service re-checks the approval inside its own transaction. */
export async function decideApproval(input: {
  actorId: string;
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  comment?: string;
  meta?: AuditMeta;
}) {
  const approval = await getDb().approvalRequest.findUnique({
    where: { id: input.approvalId },
    select: { type: true },
  });
  if (!approval) throw new LeaveError("That request is not pending.");
  if (approval.type === REGULARIZATION_APPROVAL) {
    return decideRegularization(input);
  }
  return decideLeaveApproval(input);
}

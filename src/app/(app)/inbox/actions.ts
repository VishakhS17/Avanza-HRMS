"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/services/current-user";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { LeaveError } from "@/lib/services/leave-errors";
import { decideLeaveApproval } from "@/lib/services/leave";

export type InboxActionState = {
  error?: string;
  ok?: boolean;
};

function refresh() {
  revalidatePath("/", "layout");
  revalidatePath("/inbox");
  revalidatePath("/my-space/leave");
  revalidatePath("/leave");
  revalidatePath("/my-team/leave");
}

function failure(error: unknown): InboxActionState {
  unstable_rethrow(error);
  if (error instanceof LeaveError) return { error: error.message };
  if (error instanceof EmployeeAccessError) return { error: "You cannot do that." };
  console.error(error);
  return { error: "Could not save that decision." };
}

export async function decideApprovalAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    const actor = await requireUser();
    const decision = String(formData.get("decision") ?? "");
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      return { error: "Choose approve or reject." };
    }
    await decideLeaveApproval({
      actorId: actor.id,
      approvalId: String(formData.get("approvalId") ?? ""),
      decision,
      comment: String(formData.get("comment") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

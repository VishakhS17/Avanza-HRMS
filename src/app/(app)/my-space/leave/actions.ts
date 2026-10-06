"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { requireUser } from "@/lib/services/current-user";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { LeaveError } from "@/lib/services/leave-errors";
import { cancelLeaveRequest, previewLeave, submitLeaveRequest, type LeavePreview } from "@/lib/services/leave";

export type LeaveActionState = {
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

function failure(error: unknown): LeaveActionState {
  unstable_rethrow(error);
  if (error instanceof LeaveError) return { error: error.message };
  if (error instanceof EmployeeAccessError) return { error: "You cannot do that." };
  console.error(error);
  return { error: "Could not save that leave request." };
}

export async function previewLeaveAction(input: {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  session: string;
}): Promise<LeavePreview> {
  const user = await requireUser();
  return previewLeave({ actorId: user.id, ...input });
}

export async function submitLeaveAction(
  _previous: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  try {
    const user = await requireUser();
    await submitLeaveRequest({
      actorId: user.id,
      leaveTypeId: String(formData.get("leaveTypeId") ?? ""),
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
      session: String(formData.get("session") ?? "FULL"),
      reason: String(formData.get("reason") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelLeaveAction(
  _previous: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  try {
    const user = await requireUser();
    await cancelLeaveRequest({
      actorId: user.id,
      requestId: String(formData.get("requestId") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

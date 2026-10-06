"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { requireCan } from "@/lib/services/current-user";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { adjustLeaveBalance, reverseLedgerEntry } from "@/lib/services/leave";
import { LeaveError } from "@/lib/services/leave-errors";

export type LeaveAdminState = {
  error?: string;
  ok?: boolean;
};

function refresh() {
  revalidatePath("/leave");
  revalidatePath("/my-space/leave");
  revalidatePath("/", "layout");
}

function failure(error: unknown): LeaveAdminState {
  unstable_rethrow(error);
  if (error instanceof LeaveError) return { error: error.message };
  if (error instanceof EmployeeAccessError) return { error: "You cannot do that." };
  console.error(error);
  return { error: "Could not save that balance change." };
}

export async function adjustBalanceAction(
  _previous: LeaveAdminState,
  formData: FormData,
): Promise<LeaveAdminState> {
  try {
    const actor = await requireCan("leave.manage");
    await adjustLeaveBalance({
      actorId: actor.id,
      employeeId: String(formData.get("employeeId") ?? ""),
      leaveTypeId: String(formData.get("leaveTypeId") ?? ""),
      days: String(formData.get("days") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function reverseLedgerAction(
  _previous: LeaveAdminState,
  formData: FormData,
): Promise<LeaveAdminState> {
  try {
    const actor = await requireCan("leave.manage");
    await reverseLedgerEntry({
      actorId: actor.id,
      ledgerId: String(formData.get("ledgerId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

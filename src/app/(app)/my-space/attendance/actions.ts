"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { recordPunch, submitRegularization } from "@/lib/services/attendance";
import { AttendanceError } from "@/lib/services/attendance-errors";
import { requireUser } from "@/lib/services/current-user";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { LeaveError } from "@/lib/services/leave-errors";

export type AttendanceActionState = {
  error?: string;
  ok?: boolean;
};

function refresh() {
  revalidatePath("/", "layout");
  revalidatePath("/inbox");
  revalidatePath("/my-space/attendance");
  revalidatePath("/my-team/attendance");
  revalidatePath("/attendance");
}

function failure(error: unknown, fallback: string): AttendanceActionState {
  unstable_rethrow(error);
  if (error instanceof AttendanceError || error instanceof LeaveError) return { error: error.message };
  if (error instanceof EmployeeAccessError) return { error: "You cannot do that." };
  console.error(error);
  return { error: fallback };
}

export async function punchAction(
  _previous: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  try {
    const user = await requireUser();
    const type = String(formData.get("type") ?? "");
    if (type !== "CHECK_IN" && type !== "CHECK_OUT") return { error: "Choose check in or check out." };
    await recordPunch({
      actorId: user.id,
      type,
      mode: String(formData.get("mode") ?? "OFFICE"),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "Could not record that punch.");
  }
}

export async function regularizeAction(
  _previous: AttendanceActionState,
  formData: FormData,
): Promise<AttendanceActionState> {
  try {
    const user = await requireUser();
    await submitRegularization({
      actorId: user.id,
      workDate: String(formData.get("workDate") ?? ""),
      inTime: String(formData.get("inTime") ?? ""),
      outTime: String(formData.get("outTime") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error, "Could not submit that regularization.");
  }
}

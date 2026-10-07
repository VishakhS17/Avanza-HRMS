"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { overrideAttendance, updateShift } from "@/lib/services/attendance";
import { AttendanceError } from "@/lib/services/attendance-errors";
import { requireUser } from "@/lib/services/current-user";
import { EmployeeAccessError } from "@/lib/services/employee-errors";

export type AttendanceAdminState = {
  error?: string;
  ok?: boolean;
};

function failure(error: unknown, fallback: string): AttendanceAdminState {
  unstable_rethrow(error);
  if (error instanceof AttendanceError) return { error: error.message };
  if (error instanceof EmployeeAccessError) return { error: "You cannot do that." };
  console.error(error);
  return { error: fallback };
}

export async function overrideAttendanceAction(
  _previous: AttendanceAdminState,
  formData: FormData,
): Promise<AttendanceAdminState> {
  try {
    const user = await requireUser();
    await overrideAttendance({
      actorId: user.id,
      employeeId: String(formData.get("employeeId") ?? ""),
      workDate: String(formData.get("workDate") ?? ""),
      status: String(formData.get("status") ?? ""),
      inTime: String(formData.get("inTime") ?? ""),
      outTime: String(formData.get("outTime") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    revalidatePath("/attendance");
    revalidatePath("/my-space/attendance");
    revalidatePath("/my-team/attendance");
    return { ok: true };
  } catch (error) {
    return failure(error, "Could not save that override.");
  }
}

export async function updateShiftAction(
  _previous: AttendanceAdminState,
  formData: FormData,
): Promise<AttendanceAdminState> {
  try {
    const user = await requireUser();
    const field = (name: string) => String(formData.get(name) ?? "");
    await updateShift({
      actorId: user.id,
      locationId: field("locationId"),
      name: field("name"),
      startTime: field("startTime"),
      endTime: field("endTime"),
      graceMinutes: field("graceMinutes"),
      halfDayHours: field("halfDayHours"),
      fullDayHours: field("fullDayHours"),
      earlyCheckInMinutes: field("earlyCheckInMinutes"),
      meta: readRequestMeta(await headers()),
    });
    revalidatePath("/settings/shifts");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failure(error, "Could not save that shift.");
  }
}

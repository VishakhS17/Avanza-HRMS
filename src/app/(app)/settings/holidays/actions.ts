"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { requireCan } from "@/lib/services/current-user";
import { EmployeeAccessError } from "@/lib/services/employee-errors";
import { createHoliday, setWeeklyOff, updateHoliday } from "@/lib/services/holidays";
import { LeaveError } from "@/lib/services/leave-errors";

export type HolidayActionState = {
  error?: string;
  ok?: boolean;
};

function refresh() {
  revalidatePath("/settings/holidays");
  revalidatePath("/my-space/holidays");
  revalidatePath("/my-space/leave");
}

function failure(error: unknown): HolidayActionState {
  unstable_rethrow(error);
  if (error instanceof LeaveError) return { error: error.message };
  if (error instanceof EmployeeAccessError) return { error: "You cannot do that." };
  console.error(error);
  return { error: "Could not save that holiday change." };
}

export async function setWeeklyOffAction(
  _previous: HolidayActionState,
  formData: FormData,
): Promise<HolidayActionState> {
  try {
    const actor = await requireCan("settings.view");
    await setWeeklyOff({
      actorId: actor.id,
      locationId: String(formData.get("locationId") ?? ""),
      weeklyOff: formData.getAll("weeklyOff").map(String),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function createHolidayAction(
  _previous: HolidayActionState,
  formData: FormData,
): Promise<HolidayActionState> {
  try {
    const actor = await requireCan("settings.view");
    await createHoliday({
      actorId: actor.id,
      locationId: String(formData.get("locationId") ?? ""),
      date: String(formData.get("date") ?? ""),
      name: String(formData.get("name") ?? ""),
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateHolidayAction(
  _previous: HolidayActionState,
  formData: FormData,
): Promise<HolidayActionState> {
  try {
    const actor = await requireCan("settings.view");
    await updateHoliday({
      actorId: actor.id,
      id: String(formData.get("id") ?? ""),
      name: String(formData.get("name") ?? ""),
      isActive: String(formData.get("isActive") ?? "") === "true",
      meta: readRequestMeta(await headers()),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

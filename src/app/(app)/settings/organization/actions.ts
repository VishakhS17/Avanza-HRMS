"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { requireCan } from "@/lib/services/current-user";
import { EmployeeAccessError, OrganizationError } from "@/lib/services/employee-errors";
import {
  createDepartment,
  createDesignation,
  createLocation,
  updateDepartment,
  updateDesignation,
  updateLocation,
} from "@/lib/services/organization";

export type OrgActionState = {
  error?: string;
  ok?: boolean;
};

async function meta() {
  return readRequestMeta(await headers());
}

function failure(error: unknown): OrgActionState {
  unstable_rethrow(error);
  if (error instanceof OrganizationError) return { error: error.message };
  if (error instanceof EmployeeAccessError) return { error: "You cannot do that." };
  console.error(error);
  return { error: "Could not save that change." };
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function refresh() {
  revalidatePath("/settings/organization");
  revalidatePath("/people");
  revalidatePath("/people/new");
}

export async function createDepartmentAction(
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  try {
    const actor = await requireCan("settings.view");
    await createDepartment({ actorId: actor.id, name: text(formData, "name"), meta: await meta() });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateDepartmentAction(
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  try {
    const actor = await requireCan("settings.view");
    await updateDepartment({
      actorId: actor.id,
      id: text(formData, "id"),
      name: text(formData, "name"),
      isActive: text(formData, "isActive") === "true",
      meta: await meta(),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function createDesignationAction(
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  try {
    const actor = await requireCan("settings.view");
    await createDesignation({ actorId: actor.id, name: text(formData, "name"), meta: await meta() });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateDesignationAction(
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  try {
    const actor = await requireCan("settings.view");
    await updateDesignation({
      actorId: actor.id,
      id: text(formData, "id"),
      name: text(formData, "name"),
      isActive: text(formData, "isActive") === "true",
      meta: await meta(),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function createLocationAction(
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  try {
    const actor = await requireCan("settings.view");
    await createLocation({
      actorId: actor.id,
      name: text(formData, "name"),
      city: text(formData, "city"),
      meta: await meta(),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateLocationAction(
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  try {
    const actor = await requireCan("settings.view");
    await updateLocation({
      actorId: actor.id,
      id: text(formData, "id"),
      name: text(formData, "name"),
      city: text(formData, "city"),
      isActive: text(formData, "isActive") === "true",
      meta: await meta(),
    });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

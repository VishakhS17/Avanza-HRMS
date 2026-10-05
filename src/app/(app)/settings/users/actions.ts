"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { requireCan } from "@/lib/services/current-user";
import { createUser, setUserStatus, updateUserRoles, UserAdminError } from "@/lib/services/users";

export type UserActionState = {
  error?: string;
  ok?: boolean;
};

async function meta() {
  return readRequestMeta(await headers());
}

function failure(error: unknown): UserActionState {
  unstable_rethrow(error);
  if (error instanceof UserAdminError) {
    return { error: error.message };
  }
  console.error(error);
  return { error: "Could not save that change." };
}

export async function createUserAction(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await requireCan("users.manage");
    await createUser({
      actorId: actor.id,
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      assignedRoles: formData.getAll("roles").map(String),
      reason: String(formData.get("reason") ?? ""),
      meta: await meta(),
    });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateRolesAction(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await requireCan("users.manage");
    await updateUserRoles({
      actorId: actor.id,
      userId: String(formData.get("userId") ?? ""),
      assignedRoles: formData.getAll("roles").map(String),
      reason: String(formData.get("reason") ?? ""),
      meta: await meta(),
    });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function setStatusAction(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  try {
    const actor = await requireCan("users.manage");
    const status = String(formData.get("status") ?? "");
    if (status !== "ACTIVE" && status !== "INACTIVE") {
      return { error: "Unknown status." };
    }
    await setUserStatus({
      actorId: actor.id,
      userId: String(formData.get("userId") ?? ""),
      status,
      reason: String(formData.get("reason") ?? ""),
      meta: await meta(),
    });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

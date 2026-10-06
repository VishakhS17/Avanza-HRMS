"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { readRequestMeta } from "@/lib/request-meta";
import { requireCan, requireUser } from "@/lib/services/current-user";
import {
  changeEmployeeStatus,
  changeEmployment,
  createEmployee,
  revealSensitiveField,
  updateEmployeeProfile,
  updateOwnContact,
  updateSensitiveFields,
} from "@/lib/services/employees";
import { EmployeeAccessError, EmployeeError } from "@/lib/services/employee-errors";

export type EmployeeActionState = {
  error?: string;
  ok?: boolean;
  revealed?: string;
};

async function meta() {
  return readRequestMeta(await headers());
}

function failure(error: unknown): EmployeeActionState {
  unstable_rethrow(error);
  if (error instanceof EmployeeError) {
    return { error: error.message };
  }
  if (error instanceof EmployeeAccessError) {
    return { error: "You cannot do that." };
  }
  console.error(error);
  return { error: "Could not save that change." };
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function contact(formData: FormData) {
  return {
    phone: text(formData, "phone"),
    addressLine1: text(formData, "addressLine1"),
    addressLine2: text(formData, "addressLine2"),
    city: text(formData, "city"),
    state: text(formData, "state"),
    postalCode: text(formData, "postalCode"),
    country: text(formData, "country"),
    emergencyName: text(formData, "emergencyName"),
    emergencyRelation: text(formData, "emergencyRelation"),
    emergencyPhone: text(formData, "emergencyPhone"),
  };
}

function sensitive(formData: FormData) {
  return {
    bankAccountName: text(formData, "bankAccountName"),
    bankName: text(formData, "bankName"),
    bankAccountNumber: text(formData, "bankAccountNumber"),
    bankIfsc: text(formData, "bankIfsc"),
    pan: text(formData, "pan"),
    governmentId: text(formData, "governmentId"),
    clear: formData.getAll("clear").map(String),
  };
}

export async function createEmployeeAction(
  _previous: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  try {
    const actor = await requireCan("people.view");
    const created = await createEmployee({
      actorId: actor.id,
      employeeCode: text(formData, "employeeCode"),
      name: text(formData, "name"),
      workEmail: text(formData, "workEmail"),
      dateOfBirth: text(formData, "dateOfBirth"),
      gender: text(formData, "gender"),
      joiningDate: text(formData, "joiningDate"),
      status: text(formData, "status"),
      designationId: text(formData, "designationId"),
      departmentId: text(formData, "departmentId"),
      locationId: text(formData, "locationId"),
      reportingManagerId: text(formData, "reportingManagerId"),
      employmentType: text(formData, "employmentType"),
      ...contact(formData),
      sensitive: sensitive(formData),
      meta: await meta(),
    });
    revalidatePath("/people");
    revalidatePath("/directory");
    redirect(`/people/${created.id}`);
  } catch (error) {
    return failure(error);
  }
}

export async function updateProfileAction(
  _previous: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  try {
    const actor = await requireCan("people.view");
    const employeeId = text(formData, "employeeId");
    await updateEmployeeProfile({
      actorId: actor.id,
      employeeId,
      employeeCode: text(formData, "employeeCode"),
      name: text(formData, "name"),
      workEmail: text(formData, "workEmail"),
      dateOfBirth: text(formData, "dateOfBirth"),
      gender: text(formData, "gender"),
      joiningDate: text(formData, "joiningDate"),
      ...contact(formData),
      meta: await meta(),
    });
    revalidatePath(`/people/${employeeId}`);
    revalidatePath("/people");
    revalidatePath("/directory");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateJobAction(
  _previous: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  try {
    const actor = await requireCan("people.view");
    const employeeId = text(formData, "employeeId");
    await changeEmployment({
      actorId: actor.id,
      employeeId,
      designationId: text(formData, "designationId"),
      departmentId: text(formData, "departmentId"),
      locationId: text(formData, "locationId"),
      reportingManagerId: text(formData, "reportingManagerId"),
      employmentType: text(formData, "employmentType"),
      startDate: text(formData, "startDate"),
      meta: await meta(),
    });
    revalidatePath(`/people/${employeeId}`);
    revalidatePath("/people");
    revalidatePath("/directory");
    revalidatePath("/my-team");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateStatusAction(
  _previous: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  try {
    const actor = await requireCan("people.view");
    const employeeId = text(formData, "employeeId");
    await changeEmployeeStatus({
      actorId: actor.id,
      employeeId,
      status: text(formData, "status"),
      meta: await meta(),
    });
    revalidatePath(`/people/${employeeId}`);
    revalidatePath("/people");
    revalidatePath("/directory");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateSensitiveAction(
  _previous: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  try {
    const actor = await requireCan("people.view");
    const employeeId = text(formData, "employeeId");
    await updateSensitiveFields({
      actorId: actor.id,
      employeeId,
      sensitive: sensitive(formData),
      meta: await meta(),
    });
    revalidatePath(`/people/${employeeId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function revealSensitiveAction(
  _previous: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  try {
    const actor = await requireCan("employee.sensitive.view");
    const revealed = await revealSensitiveField({
      actorId: actor.id,
      employeeId: text(formData, "employeeId"),
      field: text(formData, "field"),
      meta: await meta(),
    });
    return { ok: true, revealed };
  } catch (error) {
    return failure(error);
  }
}

export async function updateOwnContactAction(
  _previous: EmployeeActionState,
  formData: FormData,
): Promise<EmployeeActionState> {
  try {
    const actor = await requireUser();
    await updateOwnContact({
      actorId: actor.id,
      ...contact(formData),
      meta: await meta(),
    });
    revalidatePath("/my-space/profile");
    revalidatePath("/directory");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

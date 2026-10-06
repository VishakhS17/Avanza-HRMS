import { notFound, redirect } from "next/navigation";
import { EmployeeAccessError } from "@/lib/services/employee-errors";

export function redirectEmployeeAccess(error: unknown): never {
  if (error instanceof EmployeeAccessError) {
    if (error.kind === "not-found") {
      notFound();
    }
    redirect("/forbidden");
  }
  throw error;
}

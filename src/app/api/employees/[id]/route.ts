import { readEmployeeApi } from "@/lib/services/employees";
import { getCurrentUser } from "@/lib/services/current-user";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return readEmployeeApi(await getCurrentUser(), id);
}

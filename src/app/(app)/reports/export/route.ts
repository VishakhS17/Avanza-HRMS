import { can } from "@/lib/permissions";
import { readRequestMeta } from "@/lib/request-meta";
import { getCurrentUser } from "@/lib/services/current-user";
import { exportReport, parseReportSearch } from "@/lib/services/reports";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user, "reports.view")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const search = parseReportSearch(params);
  const exported = await exportReport({
    actorId: user.id,
    search,
    meta: readRequestMeta(request.headers),
  });

  return new Response(exported.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exported.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

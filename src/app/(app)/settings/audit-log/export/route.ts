import { forbidUnlessAuditViewer } from "@/lib/services/audit-access";
import {
  AUDIT_EXPORT_LIMIT,
  listAuditLogs,
  parseAuditLogSearch,
  toAuditCsv,
} from "@/lib/services/audit";

export async function GET(request: Request) {
  const denied = await forbidUnlessAuditViewer();
  if (denied) {
    return denied;
  }

  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const search = parseAuditLogSearch(params);
  const list = await listAuditLogs({ ...search, page: 1 }, { pageSize: AUDIT_EXPORT_LIMIT });
  const csv = toAuditCsv(list.rows);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="audit-log.csv"',
      "Cache-Control": "no-store",
    },
  });
}

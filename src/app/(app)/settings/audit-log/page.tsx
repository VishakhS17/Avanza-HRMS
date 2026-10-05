import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { assertCanViewAuditLog } from "@/lib/services/audit-access";
import {
  AUDIT_ACTIONS,
  AUDIT_EXPORT_LIMIT,
  AUDIT_TIME_ZONE,
  listAuditLogs,
  parseAuditLogSearch,
  type AuditLogSearch,
} from "@/lib/services/audit";

export const metadata: Metadata = {
  title: "Audit log",
};

const controlClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>["rows"][number];

function queryString(search: AuditLogSearch, page?: number): string {
  const params = new URLSearchParams();
  if (search.from) params.set("from", search.from);
  if (search.to) params.set("to", search.to);
  if (search.actor) params.set("actor", search.actor);
  if (search.action) params.set("action", search.action);
  if (search.entityType) params.set("entityType", search.entityType);
  if (search.entityId) params.set("entityId", search.entityId);
  if (page && page > 1) params.set("page", String(page));
  const value = params.toString();
  return value ? `?${value}` : "";
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: AUDIT_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(value);
}

function jsonBlock(value: unknown): string {
  if (value == null) {
    return "—";
  }
  return JSON.stringify(value, null, 2);
}

const columns: DataTableColumn<AuditRow>[] = [
  {
    id: "when",
    header: "When (IST)",
    cell: (row) => formatWhen(row.timestamp),
  },
  {
    id: "actor",
    header: "Actor",
    cell: (row) => row.actorUserId ?? "System",
  },
  {
    id: "action",
    header: "Action",
    cell: (row) => <Badge variant="outline">{row.action}</Badge>,
  },
  {
    id: "entity",
    header: "Entity",
    cell: (row) => (
      <span>
        {row.entityType}{" "}
        <span className="text-muted-foreground">{row.entityId}</span>
      </span>
    ),
  },
  {
    id: "reason",
    header: "Reason",
    cell: (row) => row.reason ?? "—",
    cellClassName: "whitespace-normal",
  },
  {
    id: "changes",
    header: "Changes",
    cellClassName: "whitespace-normal",
    cell: (row) => (
      <details>
        <summary className="cursor-pointer text-secondary">View</summary>
        <div className="mt-2 max-w-sm space-y-2 text-xs">
          <p>IP: {row.ipAddress ?? "—"}</p>
          <p className="break-all">Agent: {row.userAgent ?? "—"}</p>
          <p className="font-medium text-foreground">Before</p>
          <pre className="whitespace-pre-wrap break-all">{jsonBlock(row.before)}</pre>
          <p className="font-medium text-foreground">After</p>
          <pre className="whitespace-pre-wrap break-all">{jsonBlock(row.after)}</pre>
        </div>
      </details>
    ),
  },
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // TODO(Prompt 3): assertCanViewAuditLog is a stub. Real RBAC replaces it.
  assertCanViewAuditLog();

  const search = parseAuditLogSearch(await searchParams);
  const exportHref = `/settings/audit-log/export${queryString(search)}`;

  let result: Awaited<ReturnType<typeof listAuditLogs>> | null = null;
  let unavailable = false;
  try {
    result = await listAuditLogs(search);
  } catch (error) {
    console.error("Audit log query failed", error);
    unavailable = true;
  }

  const total = result?.total ?? 0;
  const page = result?.page ?? search.page;
  const pageSize = result?.pageSize ?? 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/settings" className="text-sm font-medium text-secondary hover:underline">
          Back to settings
        </Link>
        <PageHeader
          title="Audit log"
          description={`Append-only record of changes. Dates are calendar days in IST. CSV export includes up to ${AUDIT_EXPORT_LIMIT.toLocaleString("en-IN")} matching rows.`}
          actions={
            <Button variant="outline" asChild>
              <a href={exportHref}>Export CSV</a>
            </Button>
          }
        />
        <p className="text-sm text-muted-foreground">
          Access control is a temporary stub. Admin checks arrive with roles in the next step.
        </p>
      </div>

      <form
        method="get"
        action="/settings/audit-log"
        className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        <FormField label="From" htmlFor="audit-from">
          <Input type="date" name="from" defaultValue={search.from ?? ""} />
        </FormField>
        <FormField label="To" htmlFor="audit-to">
          <Input type="date" name="to" defaultValue={search.to ?? ""} />
        </FormField>
        <FormField label="Actor" htmlFor="audit-actor" hint="User id, or leave blank for everyone.">
          <Input name="actor" defaultValue={search.actor ?? ""} autoComplete="off" />
        </FormField>
        <FormField label="Action" htmlFor="audit-action">
          <select
            name="action"
            defaultValue={search.action ?? ""}
            className={controlClassName}
          >
            <option value="">All actions</option>
            {Object.values(AUDIT_ACTIONS).map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Entity type" htmlFor="audit-entity-type">
          <Input name="entityType" defaultValue={search.entityType ?? ""} autoComplete="off" />
        </FormField>
        <FormField label="Entity id" htmlFor="audit-entity-id">
          <Input name="entityId" defaultValue={search.entityId ?? ""} autoComplete="off" />
        </FormField>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit">Apply</Button>
          <Button variant="outline" asChild>
            <Link href="/settings/audit-log">Clear</Link>
          </Button>
        </div>
      </form>

      {unavailable ? (
        <EmptyState
          title="Audit log unavailable"
          description="Start the database with npm run db:up and apply migrations with npm run db:migrate."
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={result?.rows ?? []}
            getRowKey={(row) => row.id}
            emptyTitle="No audit events"
            emptyDescription="Nothing matches these filters."
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {total === 0 ? "No events" : `Showing ${start}–${end} of ${total}`}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Button variant="outline" asChild>
                  <Link href={`/settings/audit-log${queryString(search, page - 1)}`}>Previous</Link>
                </Button>
              ) : (
                <Button variant="outline" disabled>
                  Previous
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Page {Math.min(page, pageCount)} of {pageCount}
              </span>
              {page < pageCount ? (
                <Button variant="outline" asChild>
                  <Link href={`/settings/audit-log${queryString(search, page + 1)}`}>Next</Link>
                </Button>
              ) : (
                <Button variant="outline" disabled>
                  Next
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { visibilityLabel } from "@/lib/document-labels";
import { requireCan } from "@/lib/services/current-user";
import {
  listAssigneeChoices,
  listDocumentCategories,
  listDocumentsForHr,
  type HrDocumentRow,
} from "@/lib/services/documents";

export const metadata: Metadata = {
  title: "Documents",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function AckCell({ row }: { row: HrDocumentRow }) {
  if (!row.requiresAcknowledgement) return <span className="text-muted-foreground">—</span>;
  if (row.pending === 0) return <StatusBadge status="success">{row.acknowledged} acknowledged</StatusBadge>;
  return (
    <StatusBadge status="warning">
      {row.pending} pending · {row.acknowledged} done
    </StatusBadge>
  );
}

const columns: DataTableColumn<HrDocumentRow>[] = [
  {
    id: "title",
    header: "Title",
    cell: (row) => (
      <Link href={`/documents/${row.id}`} className="font-medium text-secondary hover:underline">
        {row.title}
      </Link>
    ),
  },
  { id: "category", header: "Category", cell: (row) => row.categoryName },
  { id: "assignees", header: "Employees", cell: (row) => row.assigneeSummary },
  { id: "version", header: "Version", cell: (row) => row.versionNumber },
  { id: "visibility", header: "Visible to", cell: (row) => visibilityLabel(row.visibility) },
  { id: "ack", header: "Acknowledgement", cell: (row) => <AckCell row={row} /> },
  {
    id: "status",
    header: "Status",
    cell: (row) =>
      row.status === "REMOVED" ? <StatusBadge status="neutral">Removed</StatusBadge> : <StatusBadge status="info">Active</StatusBadge>,
  },
];

export default async function HrDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("documents.manage");
  const params = await searchParams;
  const categoryCode = first(params.category);
  const employeeId = first(params.employee);
  const status = first(params.status) || "ACTIVE";
  const pendingOnly = first(params.pending) === "1";
  const [rows, categories, employees] = await Promise.all([
    listDocumentsForHr(user.id, { categoryCode, employeeId, status, pendingOnly }),
    listDocumentCategories(),
    listAssigneeChoices(user.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        description="Employee files, payslips, letters, and policies. Documents on your own record are handled by another HR Admin, except Policies."
        actions={
          <Button asChild>
            <Link href="/documents/new">Upload</Link>
          </Button>
        }
      />
      <form method="get" className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2 lg:grid-cols-4">
        <FormField label="Category" htmlFor="docs-category">
          <NativeSelect name="category" defaultValue={categoryCode}>
            <option value="">All categories</option>
            {categories.map((row) => (
              <option key={row.code} value={row.code}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Employee" htmlFor="docs-employee">
          <NativeSelect name="employee" defaultValue={employeeId}>
            <option value="">All employees</option>
            {employees.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} ({row.employeeCode})
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Status" htmlFor="docs-status">
          <NativeSelect name="status" defaultValue={status}>
            <option value="ACTIVE">Active</option>
            <option value="REMOVED">Removed</option>
            <option value="ALL">All</option>
          </NativeSelect>
        </FormField>
        <label className="flex items-center gap-2 self-end pb-1 text-sm text-foreground">
          <input type="checkbox" name="pending" value="1" defaultChecked={pendingOnly} />
          Pending acknowledgement only
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-4">
          <Button type="submit">Apply</Button>
          <Button variant="outline" asChild>
            <Link href="/documents">Clear</Link>
          </Button>
        </div>
      </form>
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={rows}
          getRowKey={(row) => row.id}
          emptyTitle="No documents"
          emptyDescription="Upload a document, or change the filters."
        />
      </div>
      <div className="grid gap-3 md:hidden">
        {rows.length === 0 ? (
          <EmptyState title="No documents" description="Upload a document, or change the filters." />
        ) : (
          rows.map((row) => (
            <Link key={row.id} href={`/documents/${row.id}`} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{row.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.categoryName} · Version {row.versionNumber}
                  </p>
                </div>
                {row.status === "REMOVED" ? <StatusBadge status="neutral">Removed</StatusBadge> : <AckCell row={row} />}
              </div>
              <p className="mt-2 text-sm text-foreground">{row.assigneeSummary}</p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

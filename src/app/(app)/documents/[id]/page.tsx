import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  AssignForm,
  AssignMissingForm,
  DocumentDetailsForm,
  HrRemoveForm,
  HrVersionForm,
} from "@/app/(app)/documents/forms";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { employeeStatusLabel } from "@/lib/employee-labels";
import { fileHref, formatBytes, formatDateTime, visibilityLabel } from "@/lib/document-labels";
import { requireCan } from "@/lib/services/current-user";
import { DocumentAccessError } from "@/lib/services/document-errors";
import {
  getDocumentForHr,
  listAssigneeChoices,
  POLICIES,
  type HrAssigneeView,
  type HrDocumentDetail,
} from "@/lib/services/documents";

export const metadata: Metadata = {
  title: "Document",
};

type VersionRow = HrDocumentDetail["versions"][number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function HrDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCan("documents.manage");
  let document: HrDocumentDetail;
  try {
    document = await getDocumentForHr(user.id, id);
  } catch (error) {
    if (error instanceof DocumentAccessError) notFound();
    throw error;
  }
  const active = document.status === "ACTIVE";
  const currentNumber = document.versions[0]?.versionNumber;
  const assignedIds = new Set(document.assignees.map((row) => row.employeeId));
  const choices = active && document.category.shared
    ? (await listAssigneeChoices(user.id)).filter(
        (row) => !assignedIds.has(row.id) && (document.category.code === POLICIES || row.id !== user.id),
      )
    : [];
  const pending = document.assignees.filter((row) => !row.acknowledgedAt && row.status !== "EXITED");

  const versionColumns: DataTableColumn<VersionRow>[] = [
    {
      id: "version",
      header: "Version",
      cell: (row) => (
        <span>
          {row.versionNumber}
          {row.versionNumber === currentNumber ? <span className="ml-2 text-xs text-muted-foreground">current</span> : null}
        </span>
      ),
    },
    { id: "file", header: "File", cell: (row) => `${row.fileName} · ${formatBytes(row.sizeBytes)}` },
    {
      id: "uploaded",
      header: "Uploaded",
      cell: (row) => (
        <div>
          <p>
            {row.uploadedByName}
            {row.uploadedByHr && document.category.uploader === "EMPLOYEE" ? " (HR, on behalf)" : ""} ·{" "}
            {formatDateTime(row.uploadedAt)}
          </p>
          {row.onBehalfNote ? <p className="text-xs text-muted-foreground">{row.onBehalfNote}</p> : null}
        </div>
      ),
    },
    ...(document.requiresAcknowledgement
      ? [{ id: "acks", header: "Acknowledged", cell: (row: VersionRow) => row.acknowledgements }]
      : []),
    {
      id: "open",
      header: "",
      cell: (row) =>
        document.canOpen ? (
          <Button variant="outline" size="sm" asChild>
            <a href={fileHref(document.id, row.versionNumber)}>Download</a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Employee only</span>
        ),
    },
  ];

  const assigneeColumns: DataTableColumn<HrAssigneeView>[] = [
    { id: "name", header: "Employee", cell: (row) => `${row.name} (${row.employeeCode})` },
    { id: "status", header: "Status", cell: (row) => employeeStatusLabel(row.status) },
    { id: "assigned", header: "Assigned", cell: (row) => formatDateTime(row.assignedAt) },
    ...(document.requiresAcknowledgement
      ? [
          {
            id: "ack",
            header: `Version ${currentNumber}`,
            cell: (row: HrAssigneeView) =>
              row.acknowledgedAt ? (
                <StatusBadge status="success">Acknowledged {formatDateTime(row.acknowledgedAt)}</StatusBadge>
              ) : (
                <StatusBadge status="warning">Pending</StatusBadge>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={document.title}
        description={`${document.category.name} · Visible to ${visibilityLabel(document.visibility).toLowerCase()}${
          document.visibilityOverride ? " (set on this document)" : " (category default)"
        } · Created by ${document.createdByName} on ${formatDateTime(document.createdAt)}`}
        actions={
          active ? <StatusBadge status="info">Active</StatusBadge> : <StatusBadge status="neutral">Removed</StatusBadge>
        }
      />
      {!active ? (
        <div className="rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground">
          Removed by {document.removedByName ?? "—"} on {document.removedAt ? formatDateTime(document.removedAt) : "—"}.
          Reason: {document.removedReason ?? "—"}. Employees cannot see it. Versions are kept for audit and retention.
        </div>
      ) : null}
      {document.description ? <p className="text-sm text-foreground">{document.description}</p> : null}
      {document.expiresOn ? <p className="text-sm text-muted-foreground">Expires {document.expiresOn}</p> : null}

      <Section title="Versions">
        <DataTable columns={versionColumns} data={document.versions} getRowKey={(row) => row.id} />
        {active ? (
          <HrVersionForm documentId={document.id} needsNote={document.category.uploader === "EMPLOYEE"} />
        ) : null}
      </Section>

      <Section
        title={
          document.requiresAcknowledgement
            ? `Employees · ${pending.length} pending acknowledgement of version ${currentNumber}`
            : "Employees"
        }
      >
        <DataTable columns={assigneeColumns} data={document.assignees} getRowKey={(row) => row.employeeId} />
        {active && document.category.shared ? (
          <>
            <AssignMissingForm documentId={document.id} missingCount={document.missingCount} />
            <AssignForm documentId={document.id} employees={choices} />
          </>
        ) : null}
      </Section>

      {active ? (
        <>
          <Section title="Details">
            <DocumentDetailsForm document={document} />
          </Section>
          <Section title="Remove">
            <HrRemoveForm documentId={document.id} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

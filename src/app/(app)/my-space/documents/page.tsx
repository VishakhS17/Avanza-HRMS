import type { Metadata } from "next";
import Link from "next/link";
import {
  AcknowledgeForm,
  OwnRemoveForm,
  OwnUploadForm,
  OwnVersionForm,
} from "@/app/(app)/my-space/documents/forms";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { fileHref, formatBytes, formatDateTime } from "@/lib/document-labels";
import { requireUser } from "@/lib/services/current-user";
import { listDocumentCategories, listMyDocuments, type MyDocumentRow } from "@/lib/services/documents";

export const metadata: Metadata = {
  title: "Documents",
};

function uploadedBy(row: MyDocumentRow): string {
  const when = formatDateTime(row.current.uploadedAt);
  if (!row.current.uploadedByHr) return `Uploaded by you · ${when}`;
  return `Uploaded by ${row.current.uploadedByName} (HR) · ${when}`;
}

function DocumentCard({ row, shelf }: { row: MyDocumentRow; shelf: "mine" | "hr" }) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground">{row.title}</p>
          <p className="text-sm text-muted-foreground">
            {row.categoryName} · Version {row.current.versionNumber} · {row.current.fileName} ·{" "}
            {formatBytes(row.current.sizeBytes)}
          </p>
          <p className="text-sm text-muted-foreground">{uploadedBy(row)}</p>
          {row.current.onBehalfNote ? (
            <p className="text-sm text-muted-foreground">Note from HR: {row.current.onBehalfNote}</p>
          ) : null}
          {row.expiresOn ? <p className="text-sm text-muted-foreground">Expires {row.expiresOn}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {row.pendingAcknowledgement ? <StatusBadge status="warning">Pending acknowledgement</StatusBadge> : null}
          {row.requiresAcknowledgement && row.acknowledgedAt ? (
            <StatusBadge status="success">Acknowledged {formatDateTime(row.acknowledgedAt)}</StatusBadge>
          ) : null}
        </div>
      </div>
      {row.description ? <p className="text-sm text-foreground">{row.description}</p> : null}
      <div>
        <Button variant="outline" size="sm" asChild>
          <a href={fileHref(row.id)}>Download</a>
        </Button>
      </div>
      {shelf === "hr" && row.pendingAcknowledgement ? (
        <AcknowledgeForm documentId={row.id} versionId={row.current.id} versionNumber={row.current.versionNumber} />
      ) : null}
      {shelf === "mine" && row.canReupload ? <OwnVersionForm documentId={row.id} /> : null}
      {shelf === "mine" && row.canRemove ? <OwnRemoveForm documentId={row.id} /> : null}
    </article>
  );
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ shelf?: string | string[] }>;
}) {
  const user = await requireUser();
  const shelfParam = (await searchParams).shelf;
  const shelf = (Array.isArray(shelfParam) ? shelfParam[0] : shelfParam) === "hr" ? "hr" : "mine";
  const [{ mine, fromHr, pendingCount }, categories] = await Promise.all([
    listMyDocuments(user.id),
    listDocumentCategories(),
  ]);
  const ownCategories = categories.filter((category) => category.uploader === "EMPLOYEE");
  const tabs = [
    { key: "mine", label: "Mine", href: "/my-space/documents", count: 0 },
    { key: "hr", label: "From HR", href: "/my-space/documents?shelf=hr", count: pendingCount },
  ] as const;
  const rows = shelf === "hr" ? fromHr : mine;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        description="Your identity, address, education, and certificate files, and documents HR shares with you. Managers cannot see these."
      />
      <div className="flex gap-4 border-b border-border">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              tab.key === shelf
                ? "border-b-2 border-primary px-1 pb-2 text-sm font-medium text-foreground"
                : "px-1 pb-2 text-sm text-muted-foreground"
            }
            aria-current={tab.key === shelf ? "page" : undefined}
          >
            {tab.label}
            {tab.count > 0 ? (
              <StatusBadge status="warning" className="ml-2" aria-label={`${tab.count} pending acknowledgement`}>
                {tab.count}
              </StatusBadge>
            ) : null}
          </Link>
        ))}
      </div>
      {shelf === "mine" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-medium text-foreground">Upload</h2>
          <OwnUploadForm categories={ownCategories} />
        </section>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">{shelf === "hr" ? "From HR" : "Your files"}</h2>
        {rows.length === 0 ? (
          <EmptyState
            title={shelf === "hr" ? "Nothing from HR yet" : "No files yet"}
            description={
              shelf === "hr"
                ? "Payslips, letters, and policies HR shares with you appear here."
                : "Upload your identity, address, education, and certificate documents above."
            }
          />
        ) : (
          <div className="grid gap-3">
            {rows.map((row) => (
              <DocumentCard key={row.id} row={row} shelf={shelf} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

import type { Metadata } from "next";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/services/current-user";
import { listDirectory, type DirectoryRow } from "@/lib/services/employees";

export const metadata: Metadata = {
  title: "Directory",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const columns: DataTableColumn<DirectoryRow>[] = [
  { id: "name", header: "Name", cell: (row) => row.name },
  { id: "designation", header: "Designation", cell: (row) => row.designation },
  { id: "department", header: "Department", cell: (row) => row.department },
  { id: "location", header: "Location", cell: (row) => row.location },
  { id: "manager", header: "Manager", cell: (row) => row.manager },
  { id: "email", header: "Work email", cell: (row) => row.workEmail },
  { id: "phone", header: "Phone", cell: (row) => row.phone ?? "—" },
];

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await requireUser();
  const query = first((await searchParams).q);
  const rows = await listDirectory(user.id, query);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Directory"
        description="People at Avanza Logistics who are active or on notice. No sensitive data is shown."
      />
      <form method="get" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-end">
        <div className="flex-1">
          <FormField label="Search" htmlFor="directory-q">
            <Input name="q" defaultValue={query} placeholder="Name, team, location, or email" />
          </FormField>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No people found" description="Try a different search, or check back once HR adds employees." />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable columns={columns} data={rows} getRowKey={(row) => row.id} />
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((row) => (
              <article key={row.id} className="rounded-xl border border-border bg-card p-4">
                <h2 className="font-medium text-foreground">{row.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {row.designation} · {row.department}
                </p>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Location</dt>
                    <dd>{row.location}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Manager</dt>
                    <dd>{row.manager}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="truncate">{row.workEmail}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd>{row.phone ?? "—"}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

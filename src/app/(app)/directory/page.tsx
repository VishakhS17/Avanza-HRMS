import type { Metadata } from "next";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { findNavItem } from "@/lib/navigation";

type DirectoryRow = {
  id: string;
  name: string;
  department: string;
  status: "success" | "warning" | "info" | "neutral";
  statusLabel: string;
};

const columns: DataTableColumn<DirectoryRow>[] = [
  { id: "name", header: "Name", cell: (row) => row.name },
  { id: "department", header: "Department", cell: (row) => row.department },
  {
    id: "status",
    header: "Status",
    cell: (row) => (
      <StatusBadge status={row.status}>{row.statusLabel}</StatusBadge>
    ),
  },
];

const page = findNavItem("/directory");

export const metadata: Metadata = {
  title: "Directory",
};

export default function DirectoryPage() {
  const rows: DirectoryRow[] = [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={page?.title ?? "Directory"}
        description={page?.description}
      />
      <DataTable
        columns={columns}
        data={rows}
        getRowKey={(row) => row.id}
        emptyTitle="No employees yet"
        emptyDescription="The directory will list people once employee records exist."
      />
    </div>
  );
}

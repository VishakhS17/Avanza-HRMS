import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { employeeStatusLabel, employeeStatusTone, EMPLOYEE_STATUS_OPTIONS } from "@/lib/employee-labels";
import { requireCan } from "@/lib/services/current-user";
import { listEmployees, type EmployeeListRow } from "@/lib/services/employees";
import { listDepartments, listLocations } from "@/lib/services/organization";

export const metadata: Metadata = {
  title: "People",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const columns: DataTableColumn<EmployeeListRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: (row) => (
      <Link href={`/people/${row.id}`} className="font-medium text-secondary hover:underline">
        {row.name}
      </Link>
    ),
  },
  { id: "code", header: "Code", cell: (row) => row.employeeCode },
  { id: "department", header: "Department", cell: (row) => row.department },
  { id: "location", header: "Location", cell: (row) => row.location },
  {
    id: "status",
    header: "Status",
    cell: (row) => (
      <StatusBadge status={employeeStatusTone(row.status)}>{employeeStatusLabel(row.status)}</StatusBadge>
    ),
  },
];

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("people.view");
  const params = await searchParams;
  const query = first(params.q);
  const departmentId = first(params.departmentId);
  const locationId = first(params.locationId);
  const status = first(params.status);
  const [rows, departments, locations] = await Promise.all([
    listEmployees(user.id, { query, departmentId, locationId, status }),
    listDepartments(user.id),
    listLocations(user.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        description="Employee records for HR. Job changes keep a history row."
        actions={
          <Button asChild>
            <Link href="/people/new">Add employee</Link>
          </Button>
        }
      />
      <form method="get" className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2 lg:grid-cols-4">
        <FormField label="Search" htmlFor="people-q">
          <Input name="q" defaultValue={query} placeholder="Name, email, or code" />
        </FormField>
        <FormField label="Department" htmlFor="people-department">
          <NativeSelect name="departmentId" defaultValue={departmentId}>
            <option value="">All departments</option>
            {departments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Location" htmlFor="people-location">
          <NativeSelect name="locationId" defaultValue={locationId}>
            <option value="">All locations</option>
            {locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Status" htmlFor="people-status">
          <NativeSelect name="status" defaultValue={status}>
            <option value="">All statuses</option>
            {EMPLOYEE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-4">
          <Button type="submit">Apply</Button>
          <Button variant="outline" asChild>
            <Link href="/people">Clear</Link>
          </Button>
        </div>
      </form>
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={rows}
          getRowKey={(row) => row.id}
          emptyTitle="No employees"
          emptyDescription="Add an employee, or change the filters."
        />
      </div>
      <div className="grid gap-3 md:hidden">
        {rows.length === 0 ? (
          <EmptyState title="No employees" description="Add an employee, or change the filters." />
        ) : (
          rows.map((row) => (
            <Link
              key={row.id}
              href={`/people/${row.id}`}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{row.name}</p>
                  <p className="text-sm text-muted-foreground">{row.employeeCode}</p>
                </div>
                <StatusBadge status={employeeStatusTone(row.status)}>
                  {employeeStatusLabel(row.status)}
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm text-foreground">
                {row.department} · {row.location}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

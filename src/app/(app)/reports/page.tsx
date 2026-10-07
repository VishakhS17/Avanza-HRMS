import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPLOYEE_STATUS_OPTIONS } from "@/lib/employee-labels";
import { requireCan } from "@/lib/services/current-user";
import {
  REPORT_GROUP_BY,
  REPORT_TYPE_OPTIONS,
  loadReport,
  parseReportSearch,
  reportQueryString,
  type ReportRow,
} from "@/lib/services/reports";

export const metadata: Metadata = {
  title: "Reports",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("reports.view");
  const search = parseReportSearch(await searchParams);
  const page = await loadReport(user.id, search);
  const query = reportQueryString(search);
  const columns: DataTableColumn<ReportRow>[] = page.table.columns.map((column) => ({
    id: column.id,
    header: column.header,
    cell: (row) => row[column.id] ?? "—",
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Role-scoped summaries. Managers see only their current direct reports. CSV export is audited."
        actions={
          <Button variant="outline" asChild>
            <a href={`/reports/export${query}`}>Export CSV</a>
          </Button>
        }
      />
      <form method="get" className="grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2 lg:grid-cols-3">
        <FormField label="Report" htmlFor="report-type">
          <NativeSelect name="type" defaultValue={search.type}>
            {REPORT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        {search.type === "headcount" ? (
          <FormField label="Group by" htmlFor="report-group">
            <NativeSelect name="groupBy" defaultValue={search.groupBy}>
              {REPORT_GROUP_BY.map((value) => (
                <option key={value} value={value}>
                  {value === "department" ? "Department" : value === "location" ? "Location" : "Status"}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        {search.type === "attendance-daily" ? (
          <FormField label="Date" htmlFor="report-date">
            <Input type="date" name="date" defaultValue={search.date} />
          </FormField>
        ) : null}
        {search.type === "attendance-monthly" ? (
          <FormField label="Month" htmlFor="report-month">
            <Input type="month" name="month" defaultValue={search.month} />
          </FormField>
        ) : null}
        <FormField label="Department" htmlFor="report-department">
          <NativeSelect name="departmentId" defaultValue={search.departmentId}>
            <option value="">All departments</option>
            {page.departments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Location" htmlFor="report-location">
          <NativeSelect name="locationId" defaultValue={search.locationId}>
            <option value="">All locations</option>
            {page.locations.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Status" htmlFor="report-status">
          <NativeSelect name="status" defaultValue={search.status}>
            <option value="">
              {search.type === "headcount" ? "All statuses" : "Active and notice"}
            </option>
            {EMPLOYEE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit">View</Button>
          <Button variant="outline" asChild>
            <Link href="/reports">Clear</Link>
          </Button>
        </div>
      </form>
      <h2 className="text-base font-medium text-foreground">{page.table.title}</h2>
      <DataTable
        columns={columns}
        data={page.table.rows}
        getRowKey={(row) => row.id ?? JSON.stringify(row)}
        emptyTitle="No rows"
        emptyDescription="Nothing matches these filters in your scope."
      />
    </div>
  );
}

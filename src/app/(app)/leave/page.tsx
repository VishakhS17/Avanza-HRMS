import type { Metadata } from "next";
import Link from "next/link";
import { AdjustBalanceForm, ReverseLedgerForm } from "@/app/(app)/leave/leave-admin-panel";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatDays } from "@/lib/leave-dates";
import { ledgerEntryLabel, leaveStatusLabel, leaveStatusTone, sessionLabel } from "@/lib/leave-labels";
import { requireCan } from "@/lib/services/current-user";
import {
  listAllLeaveRequests,
  listLedger,
  listLeaveEmployees,
  listMyLeave,
  type LeaveRequestView,
} from "@/lib/services/leave";

export const metadata: Metadata = {
  title: "Leave",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const columns: DataTableColumn<LeaveRequestView>[] = [
  {
    id: "employee",
    header: "Employee",
    cell: (row) => (
      <span>
        <span className="font-medium text-foreground">{row.employeeName}</span>
        <span className="block text-xs text-muted-foreground">{row.employeeCode}</span>
      </span>
    ),
  },
  {
    id: "leave",
    header: "Leave",
    cell: (row) => (
      <span>
        {row.leaveType}
        <span className="block text-xs text-muted-foreground">
          {row.startDate} to {row.endDate} · {sessionLabel(row.session)} · {formatDays(row.workingDays)} days
        </span>
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: (row) => <StatusBadge status={leaveStatusTone(row.status)}>{leaveStatusLabel(row.status)}</StatusBadge>,
  },
  {
    id: "reason",
    header: "Reason",
    cell: (row) => row.reason,
  },
];

export default async function LeaveAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("leave.manage");
  const params = await searchParams;
  const employeeId = first(params.employee);
  const [requests, employees, mine] = await Promise.all([
    listAllLeaveRequests(user.id),
    listLeaveEmployees(user.id),
    listMyLeave(user.id),
  ]);
  const ledger = employeeId ? await listLedger(user.id, employeeId) : [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Leave"
        description="Every request, plus balance adjustments and reversals. The balance is the sum of the ledger."
      />
      <DataTable
        columns={columns}
        data={requests}
        getRowKey={(row) => row.id}
        emptyTitle="No leave requests"
        emptyDescription="Requests appear here after someone applies."
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Adjust balance</h2>
        <AdjustBalanceForm employees={employees} types={mine.balances} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Ledger</h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <FormField label="Employee" htmlFor="ledger-employee">
            <NativeSelect id="ledger-employee" name="employee" defaultValue={employeeId}>
              <option value="">Choose</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} ({employee.employeeCode})
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <Button type="submit" variant="secondary">
            Show ledger
          </Button>
        </form>
        {employeeId ? (
          ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ledger entries for this employee.</p>
          ) : (
            <div className="grid gap-3">
              {ledger.map((row) => (
                <article key={row.id} className="rounded-xl border border-border bg-card p-4">
                  <p className="font-medium text-foreground">
                    {row.leaveType} · {ledgerEntryLabel(row.entryType)} · {row.days} days
                  </p>
                  <p className="text-sm text-muted-foreground">{row.reason ?? "No reason"} · {row.createdAt.slice(0, 10)}</p>
                  <ReverseLedgerForm row={row} />
                </article>
              ))}
            </div>
          )
        ) : null}
        <p className="text-sm text-muted-foreground">
          Reversals apply to accruals, carry-forward, and adjustments.{" "}
          <Link href="/my-space/leave" className="text-secondary hover:underline">
            My Leave
          </Link>
        </p>
      </section>
    </div>
  );
}

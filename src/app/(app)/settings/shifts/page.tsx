import type { Metadata } from "next";
import { ShiftForm } from "@/app/(app)/settings/shifts/shift-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { listShifts } from "@/lib/services/attendance";
import { requireCan } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Shifts",
};

export default async function ShiftsPage() {
  const user = await requireCan("attendance.manage");
  const shifts = await listShifts(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shifts"
        description="The default shift for each location, in Asia/Kolkata time. Stored days are not recalculated when a shift changes."
      />
      {shifts.length === 0 ? (
        <EmptyState title="No locations" description="Add a location under Organization first." />
      ) : (
        shifts.map((shift) => <ShiftForm key={shift.locationId} shift={shift} />)
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { weeklyOffLabel } from "@/lib/leave-labels";
import { requireUser } from "@/lib/services/current-user";
import { listMyHolidays } from "@/lib/services/holidays";

export const metadata: Metadata = {
  title: "Holidays",
};

export default async function HolidaysPage() {
  const user = await requireUser();
  const calendar = await listMyHolidays(user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Holidays"
        description={
          calendar.locationName
            ? `${calendar.locationName}. Weekly off: ${weeklyOffLabel(calendar.weeklyOff)}.`
            : "Company holidays for your location."
        }
      />
      {!calendar.locationName ? (
        <EmptyState title="No location yet" description="Holidays appear here once your job record has a location." />
      ) : calendar.holidays.length === 0 ? (
        <EmptyState title="No holidays this year" description="Active holidays for your location will be listed here." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {calendar.holidays.map((holiday) => (
            <li key={holiday.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-medium text-foreground">{holiday.name}</span>
              <span className="text-sm text-muted-foreground">{holiday.date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

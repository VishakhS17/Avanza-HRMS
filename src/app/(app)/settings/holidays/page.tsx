import type { Metadata } from "next";
import { HolidayPanel } from "@/app/(app)/settings/holidays/holiday-panel";
import { PageHeader } from "@/components/shared/page-header";
import { requireCan } from "@/lib/services/current-user";
import { listHolidayAdmin } from "@/lib/services/holidays";

export const metadata: Metadata = {
  title: "Holidays",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function HolidaySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCan("settings.view");
  const params = await searchParams;
  const data = await listHolidayAdmin(user.id, first(params.location) || undefined);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Holiday calendar"
        description="Holidays and the weekly off are set per location. Inactive holidays stay on record."
      />
      <HolidayPanel locations={data.locations} selected={data.selected} holidays={data.holidays} />
    </div>
  );
}

import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";
import { requireCan } from "@/lib/services/current-user";

const page = findNavItem("/reports");

export const metadata: Metadata = {
  title: "Reports",
};

export default async function ReportsPage() {
  await requireCan("reports.view");
  return (
    <SectionPage
      title={page?.title ?? "Reports"}
      description={page?.description ?? ""}
    />
  );
}

import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/reports");

export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsPage() {
  return (
    <SectionPage
      title={page?.title ?? "Reports"}
      description={page?.description ?? ""}
    />
  );
}

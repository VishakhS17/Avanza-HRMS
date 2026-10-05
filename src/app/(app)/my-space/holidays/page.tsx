import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/my-space/holidays");

export const metadata: Metadata = {
  title: "Holidays",
};

export default function HolidaysPage() {
  return (
    <SectionPage
      title={page?.title ?? "Holidays"}
      description={page?.description ?? ""}
    />
  );
}

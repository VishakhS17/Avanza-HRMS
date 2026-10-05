import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/my-space/attendance");

export const metadata: Metadata = {
  title: "Attendance",
};

export default function AttendancePage() {
  return (
    <SectionPage
      title={page?.title ?? "Attendance"}
      description={page?.description ?? ""}
    />
  );
}

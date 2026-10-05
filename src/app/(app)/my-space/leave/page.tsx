import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/my-space/leave");

export const metadata: Metadata = {
  title: "Leave",
};

export default function LeavePage() {
  return (
    <SectionPage
      title={page?.title ?? "Leave"}
      description={page?.description ?? ""}
    />
  );
}

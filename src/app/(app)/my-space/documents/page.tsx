import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/my-space/documents");

export const metadata: Metadata = {
  title: "Documents",
};

export default function DocumentsPage() {
  return (
    <SectionPage
      title={page?.title ?? "Documents"}
      description={page?.description ?? ""}
    />
  );
}

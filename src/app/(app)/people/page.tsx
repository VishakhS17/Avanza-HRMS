import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/people");

export const metadata: Metadata = {
  title: "People",
};

export default function PeoplePage() {
  return (
    <SectionPage
      title={page?.title ?? "People"}
      description={page?.description ?? ""}
    />
  );
}

import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/my-team");

export const metadata: Metadata = {
  title: "My Team",
};

export default function MyTeamPage() {
  return (
    <SectionPage
      title={page?.title ?? "My Team"}
      description={page?.description ?? ""}
    />
  );
}

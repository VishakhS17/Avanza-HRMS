import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";
import { requireCan } from "@/lib/services/current-user";

const page = findNavItem("/my-team");

export const metadata: Metadata = {
  title: "My Team",
};

export default async function MyTeamPage() {
  await requireCan("team.view");
  return (
    <SectionPage
      title={page?.title ?? "My Team"}
      description={page?.description ?? ""}
    />
  );
}

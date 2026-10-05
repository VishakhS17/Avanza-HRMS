import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";
import { requireCan } from "@/lib/services/current-user";

const page = findNavItem("/people");

export const metadata: Metadata = {
  title: "People",
};

export default async function PeoplePage() {
  await requireCan("people.view");
  return (
    <SectionPage
      title={page?.title ?? "People"}
      description={page?.description ?? ""}
    />
  );
}

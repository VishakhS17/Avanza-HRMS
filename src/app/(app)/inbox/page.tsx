import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/inbox");

export const metadata: Metadata = {
  title: "Inbox",
};

export default function InboxPage() {
  return (
    <SectionPage
      title={page?.title ?? "Inbox"}
      description={page?.description ?? ""}
    />
  );
}

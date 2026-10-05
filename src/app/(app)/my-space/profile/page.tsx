import type { Metadata } from "next";
import { SectionPage } from "@/components/shared/section-page";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/my-space/profile");

export const metadata: Metadata = {
  title: "Profile",
};

export default function ProfilePage() {
  return (
    <SectionPage
      title={page?.title ?? "Profile"}
      description={page?.description ?? ""}
    />
  );
}

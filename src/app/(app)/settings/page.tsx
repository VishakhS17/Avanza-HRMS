import type { Metadata } from "next";
import { SettingsPreview } from "@/app/(app)/settings/settings-preview";
import { PageHeader } from "@/components/shared/page-header";
import { findNavItem } from "@/lib/navigation";

const page = findNavItem("/settings");

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={page?.title ?? "Settings"}
        description={page?.description}
      />
      <SettingsPreview />
    </div>
  );
}

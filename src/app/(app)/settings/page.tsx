import type { Metadata } from "next";
import Link from "next/link";
import { SettingsPreview } from "@/app/(app)/settings/settings-preview";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
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
      <section className="max-w-lg rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-medium text-foreground">Audit log</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review changes by date, actor, action, and entity. Rows are append-only.
        </p>
        <div className="mt-4">
          <Button variant="secondary" asChild>
            <Link href="/settings/audit-log">Open audit log</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

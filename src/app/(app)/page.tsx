import type { Metadata } from "next";
import Link from "next/link";
import { PunchCard } from "@/components/attendance/punch-card";
import { PageHeader } from "@/components/shared/page-header";
import { flattenNavItems } from "@/lib/navigation";
import { getPunchStatus } from "@/lib/services/attendance";
import { requireUser } from "@/lib/services/current-user";

export const metadata: Metadata = {
  title: "Home",
};

export default async function HomePage() {
  const user = await requireUser();
  const punch = await getPunchStatus(user.id);
  const links = flattenNavItems().filter((item) => item.href !== "/");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Home"
        description="Internal HR workspace for Avanza Logistics."
      />
      <PunchCard status={punch} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map((item) => {
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex h-full gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <Icon
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

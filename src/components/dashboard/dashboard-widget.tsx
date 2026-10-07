import type { ReactNode } from "react";
import Link from "next/link";

type DashboardWidgetProps = {
  title: string;
  href: string;
  hrefLabel: string;
  children?: ReactNode;
  empty?: string;
};

export function DashboardWidget({ title, href, hrefLabel, children, empty }: DashboardWidgetProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        <Link href={href} className="text-sm font-medium text-secondary hover:underline">
          {hrefLabel}
        </Link>
      </div>
      {empty ? <p className="text-sm text-muted-foreground">{empty}</p> : children}
    </section>
  );
}

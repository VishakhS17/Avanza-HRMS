import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { countPendingApprovals } from "@/lib/services/approvals";
import { requireUser } from "@/lib/services/current-user";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const inboxCount = await countPendingApprovals(user.id);
  return (
    <AppShell user={user} inboxCount={inboxCount}>
      {children}
    </AppShell>
  );
}

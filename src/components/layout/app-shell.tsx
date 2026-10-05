"use client";

import { useState, type ReactNode } from "react";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { TopBar } from "@/components/layout/top-bar";
import type { Principal } from "@/lib/permissions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type AppShellProps = {
  user: Principal;
  children: ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-dvh bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border md:flex md:flex-col">
        <SidebarNav user={user} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl p-4 md:p-8">{children}</div>
        </main>
      </div>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 data-[side=left]:w-72 data-[side=left]:sm:max-w-72"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Avanza Logistics</SheetTitle>
            <SheetDescription>Main navigation</SheetDescription>
          </SheetHeader>
          <SidebarNav user={user} onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

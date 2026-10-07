import {
  BookUser,
  CalendarDays,
  CalendarOff,
  ChartColumn,
  Clock,
  Contact,
  FileText,
  House,
  Inbox,
  Settings,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { can, type Action, type Principal } from "@/lib/permissions";

export type NavItem = {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
  action: Action;
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    items: [
      {
        title: "Home",
        href: "/",
        description: "Your starting point in Avanza HRMS.",
        icon: House,
        action: "app.view",
      },
      {
        title: "Inbox",
        href: "/inbox",
        description: "Requests and messages that need attention.",
        icon: Inbox,
        action: "app.view",
      },
    ],
  },
  {
    label: "My Space",
    items: [
      {
        title: "Profile",
        href: "/my-space/profile",
        description: "Your personal and job details.",
        icon: User,
        action: "app.view",
      },
      {
        title: "Attendance",
        href: "/my-space/attendance",
        description: "Your time and attendance records.",
        icon: Clock,
        action: "app.view",
      },
      {
        title: "Leave",
        href: "/my-space/leave",
        description: "Your leave requests and balances.",
        icon: CalendarOff,
        action: "app.view",
      },
      {
        title: "Documents",
        href: "/my-space/documents",
        description: "Files shared with you.",
        icon: FileText,
        action: "app.view",
      },
      {
        title: "Holidays",
        href: "/my-space/holidays",
        description: "Company holidays.",
        icon: CalendarDays,
        action: "app.view",
      },
    ],
  },
  {
    items: [
      {
        title: "Directory",
        href: "/directory",
        description: "Find people at Avanza Logistics.",
        icon: BookUser,
        action: "app.view",
      },
      {
        title: "My Team",
        href: "/my-team",
        description: "People who report to you.",
        icon: Users,
        action: "team.view",
      },
    ],
  },
  {
    label: "HR",
    items: [
      {
        title: "People",
        href: "/people",
        description: "Employee records for HR.",
        icon: Contact,
        action: "people.view",
      },
      {
        title: "Leave",
        href: "/leave",
        description: "All leave requests and balance changes.",
        icon: CalendarOff,
        action: "leave.manage",
      },
      {
        title: "Attendance",
        href: "/attendance",
        description: "Daily attendance for everyone, with overrides.",
        icon: Clock,
        action: "attendance.manage",
      },
    ],
  },
  {
    items: [
      {
        title: "Reports",
        href: "/reports",
        description: "HR summaries and exports.",
        icon: ChartColumn,
        action: "reports.view",
      },
      {
        title: "Settings",
        href: "/settings",
        description: "Workspace configuration.",
        icon: Settings,
        action: "settings.view",
      },
    ],
  },
];

export function flattenNavItems(): NavItem[] {
  return navSections.flatMap((section) => section.items);
}

export function findNavItem(href: string): NavItem | undefined {
  return flattenNavItems().find((item) => item.href === href);
}

export function isNavItemVisible(item: NavItem, user: Principal | null): boolean {
  return can(user, item.action);
}

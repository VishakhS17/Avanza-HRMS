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

export const appRoles = ["employee", "manager", "hr", "admin"] as const;

export type AppRole = (typeof appRoles)[number];

export type NavItem = {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
  /** Intended audience. Ignored until permission checks exist. */
  roles: readonly AppRole[];
};

export type NavSection = {
  label?: string;
  items: NavItem[];
};

const everyone = appRoles;

export const navSections: NavSection[] = [
  {
    items: [
      {
        title: "Home",
        href: "/",
        description: "Your starting point in Avanza HRMS.",
        icon: House,
        roles: everyone,
      },
      {
        title: "Inbox",
        href: "/inbox",
        description: "Requests and messages that need attention.",
        icon: Inbox,
        roles: everyone,
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
        roles: everyone,
      },
      {
        title: "Attendance",
        href: "/my-space/attendance",
        description: "Your time and attendance records.",
        icon: Clock,
        roles: everyone,
      },
      {
        title: "Leave",
        href: "/my-space/leave",
        description: "Your leave requests and balances.",
        icon: CalendarOff,
        roles: everyone,
      },
      {
        title: "Documents",
        href: "/my-space/documents",
        description: "Files shared with you.",
        icon: FileText,
        roles: everyone,
      },
      {
        title: "Holidays",
        href: "/my-space/holidays",
        description: "Company holidays.",
        icon: CalendarDays,
        roles: everyone,
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
        roles: everyone,
      },
      {
        title: "My Team",
        href: "/my-team",
        description: "People who report to you.",
        icon: Users,
        roles: ["manager", "hr", "admin"],
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
        roles: ["hr", "admin"],
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
        roles: ["manager", "hr", "admin"],
      },
      {
        title: "Settings",
        href: "/settings",
        description: "Workspace configuration.",
        icon: Settings,
        roles: ["admin"],
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

/**
 * Visibility stub. Every item is shown until server-side permission checks exist.
 * The arguments are part of the future signature and are unused on purpose.
 */
export function isNavItemVisible(item: NavItem, role: AppRole | null): boolean {
  void item;
  void role;
  return true;
}

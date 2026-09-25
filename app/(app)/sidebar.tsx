"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote, Building2, ChartColumn, FileSignature, Files, HandCoins, ClipboardCheck, Earth, Handshake, House, Inbox, Landmark, ListChecks,
  Radar, Telescope, Send, Settings, SquareCheckBig, SquareKanban, Users, type LucideIcon,
} from "lucide-react";
import styles from "./shell.module.css";

type Item = { href: string; label: string; icon: LucideIcon };

// Navigation from the master spec (docs/master-spec.md part VI; docs/plans/phase-6.md §10). Same routes, regrouped.
const GROUPS: { label?: string; items: Item[] }[] = [
  { items: [{ href: "/today", label: "Today", icon: House }] },
  {
    label: "Origination",
    items: [
      { href: "/prospecting", label: "Prospecting", icon: Telescope },
      { href: "/lists", label: "Lists", icon: ListChecks },
      { href: "/deals", label: "Opportunities", icon: SquareKanban },
      { href: "/sequences", label: "Sequences", icon: Send },
      { href: "/queue", label: "Approval queue", icon: ClipboardCheck },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  { label: "Projects", items: [{ href: "/projects", label: "Projects", icon: Landmark }] },
  { label: "Capital", items: [{ href: "/funding", label: "Funding", icon: HandCoins }, { href: "/capital", label: "Capital partners", icon: Banknote }] },
  {
    label: "Intelligence",
    items: [
      { href: "/triggers", label: "Intelligence", icon: Radar },
      { href: "/people", label: "People", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/partners", label: "Partner network", icon: Handshake },
      { href: "/map", label: "Map", icon: Earth },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/tasks", label: "Actions", icon: SquareCheckBig },
      { href: "/contracts", label: "Contracts", icon: FileSignature },
      { href: "/documents", label: "Documents", icon: Files },
      { href: "/reports", label: "Reports", icon: ChartColumn },
    ],
  },
];

function NavLink({ item, pathname }: { item: Item; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link href={item.href} className={active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem} aria-current={active ? "page" : undefined}>
      <Icon size={17} strokeWidth={1.75} aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <>
      <nav className={styles.nav} aria-label="Main">
        {GROUPS.map((group, i) => (
          <div key={group.label ?? i} className={styles.navGroup}>
            {group.label && <p className={styles.navGroupLabel}>{group.label}</p>}
            {group.items.map(item => <NavLink key={item.href} item={item} pathname={pathname} />)}
          </div>
        ))}
      </nav>
      <div className={styles.navFooter}>
        <NavLink item={{ href: "/settings", label: "Settings", icon: Settings }} pathname={pathname} />
      </div>
    </>
  );
}

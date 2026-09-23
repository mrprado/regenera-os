"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, ChartColumn, ClipboardCheck, Handshake, House, Inbox, ListChecks,
  Radar, Send, Settings, SquareCheckBig, SquareKanban, Users, type LucideIcon,
} from "lucide-react";
import styles from "./shell.module.css";

type Item = { href: string; label: string; icon: LucideIcon };

// Apollo-style information architecture (SPEC section 11), in Regenera vocabulary.
const GROUPS: { label?: string; items: Item[] }[] = [
  { items: [{ href: "/today", label: "Home", icon: House }] },
  {
    label: "Prospect",
    items: [
      { href: "/people", label: "People", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/lists", label: "Lists", icon: ListChecks },
      { href: "/triggers", label: "Triggers", icon: Radar },
    ],
  },
  {
    label: "Engage",
    items: [
      { href: "/sequences", label: "Sequences", icon: Send },
      { href: "/queue", label: "Approval queue", icon: ClipboardCheck },
      { href: "/tasks", label: "Tasks", icon: SquareCheckBig },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "Win",
    items: [
      { href: "/deals", label: "Deals", icon: SquareKanban },
      { href: "/partners", label: "Partners", icon: Handshake },
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

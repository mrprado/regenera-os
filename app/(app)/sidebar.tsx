"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote, BriefcaseBusiness, ChevronRight, Earth, House, Landmark, Network, Radar, Search, Settings, Sprout, SquareCheckBig, SquareKanban, type LucideIcon,
} from "lucide-react";
import { flatNav, navFor, type NavGroup, type NavLeaf, type NavUser, settingsFor } from "@/lib/nav";
import styles from "./shell.module.css";

const ICONS: Record<string, LucideIcon> = { house: House, earth: Earth, landmark: Landmark, sprout: Sprout, banknote: Banknote, kanban: SquareKanban, network: Network, radar: Radar, briefcase: BriefcaseBusiness, check: SquareCheckBig };

/** A leaf is active when the path matches and every query param it names matches too (so /capital?tab=bonds ≠ /capital). */
function leafActive(href: string, pathname: string, params: URLSearchParams) {
  const [p, q] = href.split("?");
  if (!(pathname === p || pathname.startsWith(`${p}/`))) return false;
  const want = new URLSearchParams(q ?? "");
  for (const [k, v] of want) if (params.get(k) !== v) return false;
  if (!q) for (const k of ["tab", "view", "stage", "capital", "blocked", "path"]) if (params.get(k)) return false;
  return true;
}
const groupActive = (g: NavGroup, pathname: string) => (g.href ? pathname === g.href || pathname.startsWith(`${g.href}/`) : g.sections.some(s => s.items.some(i => { const p = i.href.split("?")[0]; return pathname === p || pathname.startsWith(`${p}/`); })));

function Leaves({ items, pathname, params, onPick }: { items: NavLeaf[]; pathname: string; params: URLSearchParams; onPick?: () => void }) {
  return <>{items.map(i => <Link key={i.href + i.label} href={i.href} onClick={onPick} className={`${styles.subItem} ${leafActive(i.href, pathname, params) ? styles.subItemActive : ""}`}>{i.label}</Link>)}</>;
}

/**
 * Consolidated sidebar (phase 10 §3): major environments only; each group opens a flyout (desktop) or an accordion
 * (phone). Only modules the member may open are shown; the server refuses the rest regardless.
 */
export function SidebarNav({ user, variant = "flyout" }: { user: NavUser; variant?: "flyout" | "accordion" }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const groups = useMemo(() => navFor(user), [user]);
  const settings = useMemo(() => settingsFor(user), [user]);
  // A flyout belongs to the page it was opened on: navigating closes it without an effect.
  const [opened, setOpened] = useState<{ key: string; path: string } | null>(null);
  const open = opened?.path === pathname ? opened.key : null;
  const setOpen = (key: string | null) => setOpened(key ? { key, path: pathname } : null);
  const [top, setTop] = useState(0);
  const [q, setQ] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const flat = useMemo(() => flatNav(user), [user]);
  const hits = q.trim().length > 1 ? flat.filter(f => `${f.path} ${f.keywords}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12) : [];

  useEffect(() => {
    if (!open || variant !== "flyout") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpened(null); };
    const onDown = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!panel.current?.contains(t) && !t.closest("[data-navgroup]")) setOpened(null); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open, variant]);

  const current = groups.find(g => g.key === open);
  return (
    <>
      <div className={styles.navSearch}>
        <Search size={14} aria-hidden />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search menu…" aria-label="Search the menu" />
      </div>
      {hits.length > 0 ? (
        <nav className={styles.nav} aria-label="Menu search results">
          {hits.map(h => <Link key={h.path} href={h.href} className={styles.subItem} onClick={() => setQ("")}>{h.path}</Link>)}
        </nav>
      ) : (
        <nav className={styles.nav} aria-label="Main">
          {groups.map(g => {
            const Icon = ICONS[g.icon] ?? House;
            const active = groupActive(g, pathname);
            if (g.href) return (
              <Link key={g.key} href={g.href} className={`${styles.navItem} ${active ? styles.navItemActive : ""}`} aria-current={active ? "page" : undefined} title={g.label}>
                <Icon size={17} strokeWidth={1.75} aria-hidden /><span>{g.label}</span>
              </Link>
            );
            const expanded = open === g.key;
            return (
              <div key={g.key}>
                <button type="button" data-navgroup className={`${styles.navItem} ${styles.navButton} ${active ? styles.navItemActive : ""}`} aria-expanded={expanded} aria-haspopup={variant === "flyout" ? "menu" : undefined} title={g.label}
                  onClick={e => {
                    const rows = g.sections.reduce((a, s) => a + s.items.length * 30 + (s.label ? 26 : 0), 50);
                    setTop(Math.max(64, Math.min((e.currentTarget as HTMLElement).getBoundingClientRect().top - 8, window.innerHeight - rows - 16)));
                    setOpen(expanded ? null : g.key);
                  }}>
                  <Icon size={17} strokeWidth={1.75} aria-hidden /><span>{g.label}</span><ChevronRight size={14} aria-hidden className={styles.chev} data-open={expanded && variant === "accordion" ? "" : undefined} />
                </button>
                {variant === "accordion" && expanded && (
                  <div className={styles.accordion}>{g.sections.map((s, i) => <div key={i}>{s.label && <p className={styles.navGroupLabel}>{s.label}</p>}<Leaves items={s.items} pathname={pathname} params={params} /></div>)}</div>
                )}
              </div>
            );
          })}
        </nav>
      )}
      <div className={styles.navFooter}>
        <Link href={user.internal ? "/settings" : "/org"} className={`${styles.navItem} ${pathname.startsWith("/settings") || pathname.startsWith("/org") ? styles.navItemActive : ""}`} title="Settings">
          <Settings size={17} strokeWidth={1.75} aria-hidden /><span>Settings</span>
        </Link>
        {variant === "accordion" && settings.length > 1 && <div className={styles.accordion}><Leaves items={settings} pathname={pathname} params={params} /></div>}
      </div>
      {variant === "flyout" && current && (
        <div ref={panel} role="menu" aria-label={current.label} className={`${styles.flyout} ${current.mega ? styles.mega : ""}`} style={current.mega ? undefined : { top }}>
          <p className={styles.flyoutTitle}>{current.label}</p>
          <div className={current.mega ? styles.megaCols : undefined}>
            {current.sections.map((s, i) => (
              <div key={i} className={styles.flyoutSection}>{s.label && <p className={styles.flyoutLabel}>{s.label}</p>}<Leaves items={s.items} pathname={pathname} params={params} onPick={() => setOpen(null)} /></div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

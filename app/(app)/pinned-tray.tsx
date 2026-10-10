"use client";
// Pinned items tray (phase 25, docs/plans/phase-25-pinned-items.md): up to six records one click away in the header.
// Click opens the record in the shared review drawer; Ctrl/Cmd-click opens it full page. Pin / Pinned toggles the record
// on the page you are on (also the P key). Drag or Alt+←/→ to reorder. Below 900 px the tray is a "Pinned (n)" menu.
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Banknote, Briefcase, Building2, FileText, Landmark, Pin as PinIcon, PinOff, Radar, Search, SquareKanban, Target, User, X, type LucideIcon } from "lucide-react";
import { RecordDrawer, type DrawerRecord } from "@/components/command-review";
import { MAX_PINS, PIN_TYPES, pinTarget, type PinType } from "@/lib/pins/vocab";
import type { Pin } from "@/lib/pins/queries";
import { pinAction, reorderPinsAction, unpinAction } from "./pin-actions";
import s from "./pinned-tray.module.css";

const ICONS: Record<string, LucideIcon> = { landmark: Landmark, kanban: SquareKanban, banknote: Banknote, file: FileText, radar: Radar, search: Search, target: Target, building: Building2, user: User, briefcase: Briefcase };
const short = (t: string) => (t.length > 24 ? `${t.slice(0, 23)}…` : t);

export default function PinnedTray({ pins, removed, canPin }: { pins: Pin[]; removed: number; canPin: boolean }) {
  const pathname = usePathname(), router = useRouter();
  const [pending, start] = useTransition();
  const [order, setOrder] = useState(pins);
  const [record, setRecord] = useState<DrawerRecord | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [note, setNote] = useState(removed ? `${removed} pinned item${removed === 1 ? " is" : "s are"} no longer available and ${removed === 1 ? "was" : "were"} removed.` : "");
  const trigger = useRef<HTMLElement | null>(null);
  const drag = useRef<string | null>(null);
  // New pins from the server replace the local (optimistic) order.
  const [seen, setSeen] = useState(pins);
  if (seen !== pins) { setSeen(pins); setOrder(pins); }
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(""), 7000); return () => window.clearTimeout(t); }, [note]);

  const target = pinTarget(pathname);
  const current = target ? order.find(p => p.type === target.type && p.entityId === target.id) : undefined;
  const refresh = () => router.refresh();

  const pin = (replaceId?: string) => {
    if (!target) return;
    if (order.length >= MAX_PINS && !replaceId) { setReplacing(true); return; }
    start(async () => {
      const r = await pinAction(target.type, target.id, replaceId);
      setReplacing(false);
      if (!r.ok) setNote(r.reason === "full" ? "Six items are pinned. Choose one to replace." : "This record cannot be pinned.");
      refresh();
    });
  };
  const remove = (p: Pin) => start(async () => { setOrder(o => o.filter(x => x.id !== p.id)); await unpinAction(p.id); refresh(); });
  const save = (next: Pin[]) => { setOrder(next); start(async () => { await reorderPinsAction(next.map(p => p.id)); refresh(); }); };
  const move = (id: string, by: number) => { const i = order.findIndex(p => p.id === id), j = i + by; if (i < 0 || j < 0 || j >= order.length) return; const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; save(next); };

  // P pins or unpins the record on this page (not while typing).
  useEffect(() => {
    if (!canPin || !target) return;
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "p" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,[contenteditable=true]")) return;
      e.preventDefault();
      if (current) remove(current); else pin();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const open = (e: React.MouseEvent<HTMLAnchorElement>, p: Pin) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault(); trigger.current = e.currentTarget; setRecord({ href: p.href, title: p.label });
  };
  const item = (p: Pin) => {
    const Icon = ICONS[PIN_TYPES[p.type as PinType]?.icon] ?? PinIcon;
    return <li key={p.id} className={s.item} data-current={current?.id === p.id || undefined} draggable onDragStart={() => { drag.current = p.id; }} onDragOver={e => e.preventDefault()}
      onDrop={() => { const from = drag.current; drag.current = null; if (!from || from === p.id) return; const next = order.filter(x => x.id !== from); next.splice(next.findIndex(x => x.id === p.id), 0, order.find(x => x.id === from)!); save(next); }}>
      <a href={p.href} title={`${PIN_TYPES[p.type as PinType]?.label ?? "Record"}: ${p.label} (Ctrl-click opens full page; Alt+←/→ moves)`} onClick={e => open(e, p)}
        onKeyDown={e => { if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); move(p.id, -1); } if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); move(p.id, 1); } }}>
        <Icon size={14} aria-hidden /><span>{short(p.label)}</span>
      </a>
      <button type="button" className={s.unpin} onClick={() => remove(p)} aria-label={`Unpin ${p.label}`} disabled={pending}><X size={13} aria-hidden /></button>
    </li>;
  };

  return (
    <div className={s.tray} aria-busy={pending || undefined}>
      {order.length > 0 && <>
        <ul className={s.list} aria-label="Pinned items">{order.map(item)}</ul>
        <details className={s.menu}><summary>Pinned ({order.length})</summary><ul>{order.map(item)}</ul></details>
      </>}
      {canPin && target && (
        <button type="button" className={s.pinButton} data-pinned={current ? "true" : undefined} onClick={() => (current ? remove(current) : pin())} disabled={pending} aria-pressed={!!current} title={current ? "Unpin this record (P)" : "Pin this record to the header (P)"}>
          {current ? <PinOff size={15} aria-hidden /> : <PinIcon size={15} aria-hidden />}{current ? "Pinned" : "Pin"}
        </button>
      )}
      {replacing && (
        <div className={s.replace} role="dialog" aria-label="Replace a pinned item">
          <p>Six items are pinned. Replace which?</p>
          <ul>{order.map(p => <li key={p.id}><button type="button" onClick={() => pin(p.id)} disabled={pending}>{short(p.label)}</button></li>)}</ul>
          <button type="button" className={s.cancel} onClick={() => setReplacing(false)}>Cancel</button>
        </div>
      )}
      {note && <p className={s.note} role="status">{note}</p>}
      {record && <RecordDrawer record={record} onClose={() => { setRecord(null); trigger.current?.focus(); }} />}
    </div>
  );
}

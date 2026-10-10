"use client";
// Record review drawer (ChatGPT, 2026-10-09; shared with the pinned tray in phase 25): a workspace record opens in a
// right-side dialog with the shell chrome hidden, so the existing guard, data, tabs and server actions apply unchanged.
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { reviewTarget } from '@/lib/review-target';
import s from './command-review.module.css';

export type DrawerRecord = { href: string; title: string };

/** The drawer itself. onClose returns focus to whatever opened it. */
export function RecordDrawer({ record, onClose }: { record: DrawerRecord; onClose: () => void }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const done = useRef(onClose);
  useEffect(() => { done.current = onClose; }, [onClose]);
  useEffect(() => {
    close.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') done.current(); };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', key); };
  }, [record.href]);
  return <div className={s.overlay}>
    <button className={s.backdrop} onClick={onClose} tabIndex={-1} aria-label="Close record review" />
    <section className={s.drawer} role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={event => {
      // The frame owns its normal keyboard sequence. At the outer boundary, wrap focus into the panel.
      if (event.key === 'Tab' && event.shiftKey && event.target === close.current) {
        event.preventDefault(); document.getElementById('command-record-frame')?.focus();
      }
    }}>
      <header className={s.header}><div><h2 id="review-title">{record.title}</h2></div><div className={s.actions}><a href={record.href} target="_blank" rel="noopener noreferrer" aria-label="Open record in a full workspace"><ArrowUpRight size={18} aria-hidden /></a><button ref={close} onClick={onClose} aria-label="Close review"><X size={20} aria-hidden /></button></div></header>
      {loaded !== record.href && <p className={s.loading} role="status">Loading record details…</p>}
      <iframe id="command-record-frame" key={record.href} src={record.href} title={`Review ${record.title}`} className={s.frame} onLoad={event => {
        const doc = event.currentTarget.contentDocument;
        if (doc) {
          if (doc.location.pathname === '/today') { done.current(); return; }
          doc.documentElement.dataset.recordPanel = 'true';
          // Navigation and actions use existing routes, guards and server actions. No duplicated record data.
          doc.addEventListener('keydown', keyboard => { if (keyboard.key === 'Escape') done.current(); });
          doc.addEventListener('keydown', keyboard => {
            if (keyboard.key !== 'Tab' || keyboard.shiftKey) return;
            const focusable = [...doc.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex="0"]')].filter(el => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
            if (doc.activeElement === focusable.at(-1)) { keyboard.preventDefault(); close.current?.focus(); }
          });
        }
        setLoaded(record.href);
      }} />
    </section>
  </div>;
}

/** Command: ordinary workspace links inside it open in the drawer instead of leaving the dashboard. */
export default function CommandReview({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<DrawerRecord | null>(null);
  const trigger = useRef<HTMLAnchorElement | null>(null);
  const dismiss = () => { setRecord(null); trigger.current?.focus(); };
  function open(event: MouseEvent<HTMLDivElement>) {
    if (window.parent !== window) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.dataset.review === 'off') return;
    const href = reviewTarget(anchor.href, window.location.origin);
    if (!href) return;
    event.preventDefault();
    trigger.current = anchor;
    setRecord({ href, title: anchor.textContent?.trim() || 'Record details' });
  }
  return <><div onClickCapture={open} data-command-review>{children}</div>{record && <RecordDrawer record={record} onClose={dismiss} />}</>;
}

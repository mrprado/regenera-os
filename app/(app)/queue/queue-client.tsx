"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { QueueItem } from "@/lib/outreach/queries";
import { approveAction, bulkApproveMassAction, regenerateAction, skipAction } from "../outreach-actions";
import styles from "./queue.module.css";

const CHANNEL: Record<string, string> = { email: "Email", linkedin_connect: "LinkedIn note", linkedin_message: "LinkedIn message" };
const words = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

export default function QueueClient({ items, back, focusId }: { items: QueueItem[]; back: string; focusId?: string }) {
  const initial = Math.max(0, items.findIndex(i => i.id === focusId));
  const [index, setIndex] = useState(initial);
  const item = items[Math.min(index, items.length - 1)];
  const approveRef = useRef<HTMLFormElement>(null);
  const skipRef = useRef<HTMLFormElement>(null);
  const regenRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.closest("input, textarea, select")) {
        if (e.key === "Escape") (el as HTMLElement).blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "a") { e.preventDefault(); approveRef.current?.requestSubmit(); }
      else if (k === "e") { e.preventDefault(); bodyRef.current?.focus(); }
      else if (k === "r") { e.preventDefault(); regenRef.current?.requestSubmit(); }
      else if (k === "s") { e.preventDefault(); skipRef.current?.requestSubmit(); }
      else if (k === "arrowdown" || k === "j") { e.preventDefault(); setIndex(i => Math.min(items.length - 1, i + 1)); }
      else if (k === "arrowup" || k === "k") { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);

  const massIds = items.filter(i => i.tier === "mass").map(i => i.id);

  return (
    <div className={styles.shell}>
    <div className={styles.layout}>
      <aside className={styles.list} aria-label="Drafts">
        {massIds.length > 0 && (
          <form action={bulkApproveMassAction} className={styles.bulk}>
            <input type="hidden" name="back" value={back} />
            {massIds.map(id => <input key={id} type="hidden" name="ids" value={id} />)}
            <button className={styles.bulkBtn} type="submit">Approve all {massIds.length} mass drafts</button>
          </form>
        )}
        <ol className={styles.items}>
          {items.map((it, i) => (
            <li key={it.id}>
              <button type="button" className={`${styles.itemBtn} ${i === index ? styles.itemActive : ""}`} onClick={() => setIndex(i)} aria-current={i === index}>
                <span className={styles.itemTop}>
                  <b>{it.contactName}</b>
                  <span className={it.status === "style_failed" ? styles.flagBad : styles.flag}>{it.status === "style_failed" ? "Fix style" : it.tier}</span>
                </span>
                <span className={styles.itemSub}>{it.orgName ?? "No organization"}</span>
                <span className={styles.itemSub}>Step {(it.step ?? 0) + 1} · {CHANNEL[it.channel] ?? it.channel}{it.scheduledAt ? ` · ${it.scheduledAt.slice(0, 10)}` : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <section className={styles.editor} aria-label="Draft">
        <header className={styles.editorHead}>
          <div>
            <h2 className={styles.to}>{item.contactName}{item.contactTitle ? <span>, {item.contactTitle}</span> : null}</h2>
            <p className={styles.meta}>
              {CHANNEL[item.channel]} · step {(item.step ?? 0) + 1} of {item.sequenceName ?? "manual"}{item.angleTag ? ` · angle: ${item.angleTag}` : ""}
              {item.channel === "email" && item.email ? ` · to ${item.email}` : ""}
            </p>
          </div>
          <Link className={styles.open} href={`/people/${item.contactId}`}>Open record</Link>
        </header>

        {item.styleIssues?.length ? (
          <ul className={styles.issues}>{item.styleIssues.map((s, i) => <li key={i}>{s.detail}</li>)}</ul>
        ) : null}

        <form key={item.id} ref={approveRef} action={approveAction} className={styles.form}>
          <input type="hidden" name="id" value={item.id} /><input type="hidden" name="back" value={back} />
          {item.channel === "email" && (
            <label className={styles.label}>Subject
              <input name="subject" defaultValue={item.subject} className={styles.subject} />
            </label>
          )}
          {item.channel !== "email" && <input type="hidden" name="subject" value="" />}
          <BodyField item={item} bodyRef={bodyRef} />
          <div className={styles.actions}>
            <button className="btn btn--primary" type="submit">Approve <kbd>A</kbd></button>
            <button className="btn" type="button" onClick={() => bodyRef.current?.focus()}>Edit <kbd>E</kbd></button>
            <button className="btn" type="button" onClick={() => regenRef.current?.requestSubmit()}>Regenerate angle <kbd>R</kbd></button>
            <button className="btn" type="button" onClick={() => skipRef.current?.requestSubmit()}>Skip <kbd>S</kbd></button>
          </div>
          {item.channel !== "email" && <p className={styles.hint}>LinkedIn steps are assisted: approving creates a task with this text. You send it on LinkedIn.</p>}
          {item.tier === "mass" && item.channel === "email" && <p className={styles.hint}>Mass tier: sent from the secondary domain with an unsubscribe link and the postal footer.</p>}
        </form>
        <form ref={regenRef} action={regenerateAction} className={styles.regen}>
          <input type="hidden" name="id" value={item.id} /><input type="hidden" name="back" value={back} />
          <input name="angle" placeholder="Optional: the angle to try instead" aria-label="Angle to try instead" />
        </form>
        <form ref={skipRef} action={skipAction}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="back" value={back} /></form>
        <p className={styles.keys}><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Esc</kbd> leave the text box</p>
      </section>

      <aside className={styles.context} aria-label="Context">
        <h3 className={styles.ctxTitle}>{item.orgName ?? "No organization"}</h3>
        {item.score !== null && <p className={styles.ctxMeta}>Score {item.score}</p>}
        {item.trigger && (<><p className={styles.ctxLabel}>Current trigger</p><p className={styles.ctxText}>{item.trigger}</p></>)}
        {item.triggerRead && <p className={styles.read}>{item.triggerRead}</p>}
        {item.decisionRead && (<><p className={styles.ctxLabel}>Dossier decision read</p><p className={styles.read}>{item.decisionRead}</p></>)}
        {item.regenerativeAngle && (<><p className={styles.ctxLabel}>Regenerative angle</p><p className={styles.ctxText}>{item.regenerativeAngle}</p></>)}
        {!item.trigger && !item.decisionRead && <p className={styles.ctxText}>No dossier or current trigger. Check the draft uses only what is on the record.</p>}
        {item.orgId && <Link className={styles.open} href={`/companies/${item.orgId}`}>Full dossier</Link>}
      </aside>
    </div>
    </div>
  );
}

function BodyField({ item, bodyRef }: { item: QueueItem; bodyRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const [body, setBody] = useState(item.body);
  return (
    <>
      <label className={styles.label}>Message
        <textarea ref={bodyRef} name="body" value={body} onChange={e => setBody(e.target.value)} className={styles.body} rows={item.channel === "email" ? 12 : 6} />
      </label>
      <p className={styles.count}>
        {words(body)} words{item.firstEmail ? " · first touch, 120 max" : ""}{item.channel === "linkedin_connect" ? ` · ${body.length}/280 characters` : ""}
      </p>
    </>
  );
}

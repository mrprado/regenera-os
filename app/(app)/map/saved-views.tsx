"use client";

// Named ATLAS views: save the current position, basemap, layers and mode; open one to restore it exactly.
import { useEffect, useState } from "react";
import { withBase } from "@/lib/base-path";
import styles from "./map.module.css";

type View = { id: string; name: string; view: string; createdBy: string };

export default function SavedViews() {
  const [views, setViews] = useState<View[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch(withBase("/api/map/views")).then(r => r.json() as Promise<{ views?: View[] }>).then(j => { if (live) setViews(j.views ?? []); }).catch(() => { if (live) setNote("Saved views unavailable"); });
    return () => { live = false; };
  }, [open]);

  async function save() {
    const r = await fetch(withBase("/api/map/views"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, view: window.location.hash }) });
    const j = (await r.json()) as View & { error?: string };
    if (!r.ok) { setNote(j.error ?? "Could not save"); return; }
    setViews(v => [{ ...j, createdBy: "you" }, ...v]); setName(""); setNote(`Saved "${j.name}"`);
  }
  function go(v: View) { history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${v.view}`); window.location.reload(); }

  return (
    <div className={styles.views}>
      <button type="button" className={`${styles.glass} ${styles.viewsBtn}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>Saved views</button>
      {open && <div className={`${styles.glass} ${styles.viewsMenu}`}>
        <form onSubmit={e => { e.preventDefault(); if (name.trim()) void save(); }} className={styles.viewsSave}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name this view" aria-label="View name" maxLength={80} />
          <button type="submit" disabled={!name.trim()}>Save</button>
        </form>
        {note && <p className={styles.viewsNote}>{note}</p>}
        {views.length === 0 ? <p className={styles.viewsNote}>No saved views yet.</p> : <ul>{views.map(v => <li key={v.id}><button type="button" onClick={() => go(v)}>{v.name}</button><small>{v.createdBy}</small></li>)}</ul>}
      </div>}
    </div>
  );
}

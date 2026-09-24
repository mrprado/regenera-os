"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import styles from "./deals.module.css";

export type KanbanDeal = {
  id: string; name: string; stage: string; orgId: string | null; orgName: string | null; engagement: string; path: string;
  value: number | null; nextAction: string | null; nextActionDate: string | null; source: string; overdue: boolean;
};

/** Drag a card to another column; the move is saved through the moveDeal server action (audited). */
export default function Kanban({ columns, deals, action, back }: {
  columns: { key: string; label: string }[];
  deals: KanbanDeal[];
  action: (formData: FormData) => Promise<void>;
  back: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const idInput = useRef<HTMLInputElement>(null);
  const stageInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [local, setLocal] = useState(deals);

  const drop = (stage: string) => {
    if (!dragging) return;
    const d = local.find(x => x.id === dragging);
    setOver(null);
    setDragging(null);
    if (!d || d.stage === stage) return;
    setLocal(ls => ls.map(x => (x.id === d.id ? { ...x, stage } : x)));
    idInput.current!.value = d.id;
    stageInput.current!.value = stage;
    form.current!.requestSubmit();
  };

  return (
    <>
      <form ref={form} action={action} hidden>
        <input ref={idInput} name="id" /><input ref={stageInput} name="stage" /><input name="back" defaultValue={back} />
      </form>
      <div className={styles.board}>
        {columns.map(col => {
          const items = local.filter(d => d.stage === col.key);
          const total = items.reduce((a, d) => a + (d.value ?? 0), 0);
          return (
            <section
              key={col.key}
              className={`${styles.column} ${over === col.key ? styles.columnOver : ""}`}
              onDragOver={e => { e.preventDefault(); setOver(col.key); }}
              onDragLeave={() => setOver(o => (o === col.key ? null : o))}
              onDrop={e => { e.preventDefault(); drop(col.key); }}
              aria-label={col.label}
            >
              <header className={styles.colHead}>
                <span>{col.label}</span><span className={styles.colCount}>{items.length}</span>
              </header>
              {total > 0 && <p className={styles.colValue}>${Math.round(total).toLocaleString("en-US")}</p>}
              <div className={styles.cards}>
                {items.map(d => (
                  <article
                    key={d.id}
                    className={`${styles.card} ${dragging === d.id ? styles.cardDragging : ""}`}
                    draggable
                    onDragStart={() => setDragging(d.id)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                  >
                    <p className={styles.cardTitle}>{d.name}</p>
                    {d.orgId && <Link className={styles.cardOrg} href={`/companies/${d.orgId}`}>{d.orgName}</Link>}
                    <p className={styles.cardMeta}>{d.engagement.replace(/_/g, " ")} · {d.path === "capital_mandate" ? "capital" : "project"}{d.value ? ` · $${Math.round(d.value).toLocaleString("en-US")}` : ""}</p>
                    {d.nextAction && <p className={`${styles.next} ${d.overdue ? styles.overdue : ""}`}>{d.nextActionDate ? `${d.nextActionDate}: ` : ""}{d.nextAction}</p>}
                    {!d.nextAction && <p className={`${styles.next} ${styles.overdue}`}>No next action</p>}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

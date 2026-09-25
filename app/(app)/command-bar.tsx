"use client";

import { Command } from "cmdk";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { confirmProposalAction, rejectProposalAction } from "./intel-actions";
import styles from "./command-bar.module.css";
import { withBase } from "@/lib/base-path";

type Turn = { role: "user" | "assistant"; text: string; proposals?: { id: string; title: string }[] };

const PAGES = [
  ["Today", "/today"], ["Projects", "/projects"], ["Project pipeline", "/projects?view=board"], ["Map", "/map"], ["People", "/people"], ["Companies", "/companies"], ["Prospecting", "/prospecting"], ["Triggers", "/triggers"], ["Funding", "/funding"],
  ["Approval queue", "/queue"], ["Sequences", "/sequences"], ["Inbox", "/inbox"], ["Tasks", "/tasks"], ["Opportunities", "/deals"], ["Partners", "/partners"],
  ["Reports", "/reports"], ["Forecast", "/reports?tab=forecast"], ["Settings", "/settings"],
] as const;
const EXAMPLES = [
  "Show family offices in Latin America with a trigger this year",
  "Which deals have no next action?",
  "What is the weighted pipeline by stage?",
  "Which replies still need an answer?",
  "Energy developers we have not contacted yet",
  "Which water grants close in the next 30 days?",
  "Which projects are blocked, and which need capital in the next six months?",
];
const TOOL_LABEL: Record<string, string> = {
  search_people: "Searching people", search_companies: "Searching companies", search_deals: "Reading deals", search_triggers: "Reading triggers",
  get_person: "Opening a record", pipeline_metrics: "Computing metrics", list_replies: "Reading replies", search_funding: "Searching funding", search_projects: "Reading projects",
};

export default function CommandBar() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [hits, setHits] = useState<{ type: string; label: string; sub: string; href: string }[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(o => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);
  // Record search across projects, capital, companies, people, contracts, funding and documents (scoped server-side).
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(withBase(`/api/search?q=${encodeURIComponent(q)}`), { signal: ctrl.signal })
        .then(r => (r.ok ? r.json() as Promise<{ hits: typeof hits }> : { hits: [] })).then(d => setHits(d.hits)).catch(() => {});
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [value]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.map(t => ({ role: t.role, text: t.text }));
    setTurns(t => [...t, { role: "user", text: q }]);
    setValue("");
    setBusy("Thinking");
    try {
      const res = await fetch(withBase("/api/command"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, history }) });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setTurns(t => [...t, { role: "assistant", text: err.error ?? `Error ${res.status}` }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line) continue;
          const e = JSON.parse(line) as { type: string; name?: string; answer?: string; error?: string; proposals?: { id: string; title: string }[] };
          if (e.type === "tool" && e.name) setBusy(TOOL_LABEL[e.name] ?? (e.name.startsWith("propose_") ? "Preparing a proposal" : "Working"));
          if (e.type === "done") setTurns(t => [...t, { role: "assistant", text: e.answer ?? "", proposals: e.proposals }]);
          if (e.type === "error") setTurns(t => [...t, { role: "assistant", text: e.error ?? "Something went wrong." }]);
        }
      }
    } catch {
      setTurns(t => [...t, { role: "assistant", text: "The request failed. Try again." }]);
    } finally {
      setBusy(null);
    }
  }

  const shownHits = value.trim().length >= 2 ? hits : [];
  const filteredPages = PAGES.filter(([label]) => !value || label.toLowerCase().includes(value.toLowerCase()));

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label="Ask the OS">
        Ask the OS <kbd>Ctrl K</kbd>
      </button>
      <Command.Dialog open={open} onOpenChange={setOpen} label="Ask the OS" className={styles.dialog} overlayClassName={styles.overlay} shouldFilter={false}>
        <div className={styles.head}>
          <Command.Input value={value} onValueChange={setValue} placeholder="Search records, ask a question, or jump to a page" className={styles.input}
            onKeyDown={e => {
              if (e.key === "Enter" && value.trim() && filteredPages.length === 0 && shownHits.length === 0) { e.preventDefault(); void ask(value); }
            }} />
        </div>
        {(turns.length > 0 || busy) && (
          <div className={styles.chat} aria-live="polite">
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? styles.user : styles.answer}>
                <p>{t.text}</p>
                {t.proposals?.map(p => (
                  <div key={p.id} className={styles.proposal}>
                    <span>{p.title}</span>
                    <form action={confirmProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={pathname} /><button type="submit" className={styles.confirm}>Confirm</button></form>
                    <form action={rejectProposalAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={pathname} /><button type="submit" className={styles.reject}>Discard</button></form>
                  </div>
                ))}
              </div>
            ))}
            {busy && <p className={styles.busy}>{busy}…</p>}
            <div ref={endRef} />
          </div>
        )}
        <Command.List className={styles.list}>
          {value.trim() && (
            <Command.Item value={`ask:${value}`} onSelect={() => void ask(value)} className={styles.item}>Ask: “{value.trim()}”</Command.Item>
          )}
          {turns.length === 0 && !value && (
            <Command.Group heading="Try asking" className={styles.group}>
              {EXAMPLES.map(x => <Command.Item key={x} value={x} onSelect={() => void ask(x)} className={styles.item}>{x}</Command.Item>)}
            </Command.Group>
          )}
          {shownHits.length > 0 && (
            <Command.Group heading="Records" className={styles.group}>
              {shownHits.map(h => (
                <Command.Item key={`${h.type}:${h.href}:${h.label}`} value={`rec:${h.type}:${h.label}:${h.href}`} className={styles.item}
                  onSelect={() => { setOpen(false); if (/^https?:/.test(h.href)) window.open(h.href, "_blank", "noopener"); else router.push(h.href); }}>
                  {h.label}<span style={{ opacity: 0.6, marginLeft: 8, fontSize: 12 }}>{h.type}{h.sub ? ` · ${h.sub}` : ""}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {filteredPages.length > 0 && (
            <Command.Group heading="Go to" className={styles.group}>
              {filteredPages.map(([label, href]) => (
                <Command.Item key={href} value={`go:${href}`} onSelect={() => { setOpen(false); router.push(href); }} className={styles.item}>{label}</Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <p className={styles.foot}>Answers use only your mandates. Changes are proposals: nothing happens until you click Confirm.</p>
      </Command.Dialog>
    </>
  );
}

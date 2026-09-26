import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { EDGE_TYPES } from "@/db/graph";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { buildGraph, neighbourhood, warmPaths } from "@/lib/graph/graph";
import { addEdgeAction } from "../relationship-actions";
import styles from "../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relationships" };

const KIND_COLOR: Record<string, string> = { regenera: "#173b2a", person: "#476b5e", organization: "#b59a5b", project: "#7a8675" };
const href = (k: string) => (k.startsWith("p:") ? `/people/${k.slice(2)}` : k.startsWith("o:") ? `/companies/${k.slice(2)}` : k.startsWith("prj:") ? `/projects/${k.slice(4)}` : "/today");

/** Relationship graph (§14): who connects Regenera to a person, organization or project, and why. */
export default async function RelationshipsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/relationships");
  const sp = await searchParams;
  const g = await buildGraph(appDb(), user.scope.mandateIds);
  const target = sp.target && g.nodes.has(sp.target) ? sp.target : null;
  const paths = target ? warmPaths(g, target, 3) : [];
  const ego = neighbourhood(g, target ?? "regenera", target ? 2 : 1, 36);
  const q = (sp.q ?? "").toLowerCase();
  const options = [...g.nodes.entries()].filter(([k]) => k !== "regenera").filter(([, n]) => !q || n.label.toLowerCase().includes(q)).sort((a, b) => a[1].label.localeCompare(b[1].label)).slice(0, 400);
  const nodeList = [...g.nodes.values()];
  const counts = { people: nodeList.filter(n => n.kind === "person").length, orgs: nodeList.filter(n => n.kind === "organization").length, edges: g.edges.length };

  const center = target ?? "regenera";
  const ring1 = ego.nodes.filter(n => n !== center && ego.edges.some(e => (e.a === center && e.b === n) || (e.b === center && e.a === n)));
  const ring2 = ego.nodes.filter(n => n !== center && !ring1.includes(n));
  const pos = new Map<string, [number, number]>([[center, [300, 210]]]);
  ring1.forEach((n, i) => pos.set(n, [300 + 125 * Math.cos((2 * Math.PI * i) / Math.max(1, ring1.length)), 210 + 125 * Math.sin((2 * Math.PI * i) / Math.max(1, ring1.length))]));
  ring2.forEach((n, i) => pos.set(n, [300 + 200 * Math.cos((2 * Math.PI * i) / Math.max(1, ring2.length) + 0.3), 210 + 185 * Math.sin((2 * Math.PI * i) / Math.max(1, ring2.length) + 0.3)]));

  return (
    <>
      <PageHeader title="Relationships" />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -4 }}>{counts.people} people, {counts.orgs} organizations, {counts.edges} connections from records (contacts, mailbox correspondence, introductions, project and contract parties, bids) and manual entries. Warm paths prefer strong connections; every hop shows why it exists. LinkedIn is never scraped.</p>
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>Find a warm path</p>
            <form className={styles.inline} method="get">
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Filter names" aria-label="Filter" />
              <select name="target" defaultValue={target ?? ""} aria-label="Target" style={{ maxWidth: 340 }}><option value="">Choose a person, organization or project</option>{options.map(([k, n]) => <option key={k} value={k}>{n.label} · {n.kind}</option>)}</select>
              <button className="btn" type="submit">Find</button>
            </form>
            {target && (paths.length === 0 ? <p className={r.empty}>No path from Regenera yet. Record how you know someone connected to them.</p> : paths.map((p, i) => (
              <div key={i} style={{ marginTop: 10 }}>
                <p className={ui.sub}><b>Path {i + 1}</b> · warmth {p.warmth} · {p.hops.length} hop{p.hops.length === 1 ? "" : "s"}</p>
                <ol style={{ margin: "2px 0 0 18px", fontSize: 13 }}>{p.hops.map((h, j) => <li key={j}><Link href={href(p.nodes[j + 1])}>{h.to}</Link> <span className={ui.sub}>via {h.from}: {h.why} (strength {h.strength})</span></li>)}</ol>
              </div>
            )))}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>{target ? `Network around ${g.nodes.get(target)!.label}` : "Direct connections of Regenera"}</p>
            <svg viewBox="0 0 600 420" style={{ width: "100%", maxHeight: 460 }} role="img" aria-label="Relationship graph">
              {ego.edges.filter(e => pos.has(e.a) && pos.has(e.b)).map((e, i) => <line key={i} x1={pos.get(e.a)![0]} y1={pos.get(e.a)![1]} x2={pos.get(e.b)![0]} y2={pos.get(e.b)![1]} stroke="#b9b4a6" strokeWidth={0.6 + e.strength * 2} opacity={0.7}><title>{e.why}</title></line>)}
              {[...pos.entries()].map(([k, [x, y]]) => {
                const n = g.nodes.get(k)!;
                return <a key={k} href={`?target=${encodeURIComponent(k)}`}><circle cx={x} cy={y} r={k === center ? 11 : 7} fill={KIND_COLOR[n.kind]} stroke="#fff" strokeWidth={1.5}><title>{n.label}</title></circle><text x={x} y={y + (k === center ? 24 : 18)} fontSize={k === center ? 12 : 10} textAnchor="middle" fill="#1d2522">{n.label.slice(0, 26)}</text></a>;
              })}
            </svg>
            <p className={ui.sub}>Forest: Regenera · teal: people · gold: organizations · grey: projects. Line weight = strength. Click a node to centre it.</p>
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Record a relationship</p>
            <form action={addEdgeAction} className={styles.stack}>
              <label>From<select name="from" required defaultValue=""><option value="" disabled>Choose</option>{options.map(([k, n]) => <option key={k} value={k}>{n.label}</option>)}</select></label>
              <label>Relationship<select name="type">{EDGE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
              <label>To<select name="to" required defaultValue={target ?? ""}><option value="" disabled>Choose</option>{options.map(([k, n]) => <option key={k} value={k}>{n.label}</option>)}</select></label>
              <label>Strength (0.1 weak – 1 strong)<input name="strength" type="number" min={0.1} max={1} step={0.1} defaultValue={0.5} /></label>
              <label>Since<input name="since" type="date" /></label>
              <label>Note<input name="note" /></label>
              <button className="btn btn--primary" type="submit">Record</button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}

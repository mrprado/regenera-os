import Link from "next/link";
import { and, desc, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { entityAliases, projects, relationshipEdges } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { activePacks, PACKS } from "@/lib/fabric/packs";
import { DOMAINS, familyGroups } from "@/lib/fabric/sources";
import { ENTITIES, ENTITY_TYPES } from "@/lib/ontology/entities";
import { PREDICATES, PREDICATE_KEYS } from "@/lib/ontology/relations";
import { MACHINES, PROJECT_GATES } from "@/lib/ontology/states";
import { ALIAS_SCHEMES, EVIDENCE_LEVELS, VISIBILITY } from "@/lib/ontology/taxonomies";
import { addAliasAction, addEdgeAction } from "../../ontology-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ontology & data fabric" };

const TABS = [["entities", "Entities"], ["relations", "Relationships"], ["states", "Stages & gates"], ["sources", "Sources & families"], ["packs", "Country packs"], ["identity", "Identifiers & edges"]] as const;
const Opts = ({ o }: { o: Record<string, string> }) => <>{Object.entries(o).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</>;

export default async function OntologyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/intelligence/ontology");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "entities";
  const db = appDb();
  return <>
    <PageHeader title="Ontology & data fabric" />
    <Notice text={sp.notice} />
    <p className={ui.notice}>The canonical model every screen, import, connector, automation and AI agent shares: what things are, how they relate, which stages they move through, and which sources answer which questions at what evidence level. Global data screens; official sources verify; project evidence decides.</p>
    <nav className={ui.tabs} aria-label="Ontology views">{TABS.map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={k === "entities" ? "/intelligence/ontology" : `/intelligence/ontology?tab=${k}`}>{v}</Link>)}</nav>

    {tab === "entities" && <section className={r.panel}>
      <p className={r.panelTitle}>{ENTITY_TYPES.length} entity types</p>
      <table className={ui.table}><thead><tr><th>Entity</th><th>Group</th><th>Held in</th><th>Note</th></tr></thead><tbody>
        {ENTITY_TYPES.map(k => <tr key={k}><td><b>{ENTITIES[k].label}</b> <span className={ui.sub}>{k}</span></td><td>{ENTITIES[k].group}</td><td className={ui.sub}>{ENTITIES[k].table}</td><td className={ui.sub}>{ENTITIES[k].note}</td></tr>)}
      </tbody></table>
      <p className={r.panelTitle} style={{ marginTop: 24 }}>Visibility</p>
      <p className={ui.sub}>{Object.values(VISIBILITY).join(" · ")}. Community-controlled and TEK-restricted records never reach search, Ask or MCP.</p>
      <p className={r.panelTitle} style={{ marginTop: 24 }}>Evidence levels</p>
      <table className={ui.table}><tbody>{Object.values(EVIDENCE_LEVELS).map(l => <tr key={l.code}><td><b>{l.code}</b></td><td>{l.label}</td><td className={ui.sub}>{l.use}</td></tr>)}</tbody></table>
    </section>}

    {tab === "relations" && <section className={r.panel}>
      <p className={r.panelTitle}>{PREDICATE_KEYS.length} relationship types</p>
      <p className={ui.sub}>The graph grammar: an edge is refused when its ends are not of the allowed types. Edges can carry validity dates and the claim that supports them.</p>
      <table className={ui.table}><thead><tr><th>Relationship</th><th>From</th><th>To</th></tr></thead><tbody>
        {PREDICATE_KEYS.map(k => <tr key={k}><td><b>{PREDICATES[k].label}</b> <span className={ui.sub}>{k}</span></td><td className={ui.sub}>{PREDICATES[k].from.join(", ")}</td><td className={ui.sub}>{PREDICATES[k].to.join(", ")}</td></tr>)}
      </tbody></table>
    </section>}

    {tab === "states" && <>
      <section className={r.panel}><p className={r.panelTitle}>Project gates 0–8</p>
        <p className={ui.sub}>The stored stage stays the tracker stage; the gate is derived from it.</p>
        <table className={ui.table}><thead><tr><th>Gate</th><th>Stages</th><th>To pass</th></tr></thead><tbody>
          {PROJECT_GATES.map(g => <tr key={g.gate}><td><b>{g.gate} {g.label}</b></td><td className={ui.sub}>{g.stages.join(", ").replace(/_/g, " ")}</td><td className={ui.sub}>{g.exit}</td></tr>)}
        </tbody></table></section>
      {Object.entries(MACHINES).map(([k, m]) => <section key={k} className={r.panel}><p className={r.panelTitle}>{m.label}</p>
        <table className={ui.table}><thead><tr><th>State</th><th>Can move to</th></tr></thead><tbody>
          {Object.entries(m.states).map(([s, label]) => <tr key={s}><td>{label}{m.humanOnly.includes(s) ? <span className={ui.chip}> person only</span> : null}</td><td className={ui.sub}>{[...(m.next[s] ?? []), ...m.exits.filter(x => x !== s)].map(x => m.states[x as keyof typeof m.states] ?? x).join(", ") || "—"}</td></tr>)}
        </tbody></table>
        <p className={ui.sub}>Any state may also step back one stage. Moves marked person only are proposed by AI or automations, never made by them.</p></section>)}
    </>}

    {tab === "sources" && <>{familyGroups().map(g => <section key={g.family} className={r.panel}><p className={r.panelTitle}>{g.label} ({g.sources.length})</p>
      <table className={ui.table}><thead><tr><th>Source</th><th>Domain</th><th>Level</th><th>Resolution · period · update</th><th>Maps to</th><th>Licence · commercial</th><th>State</th></tr></thead><tbody>
        {g.sources.map(s => <tr key={s.key}><td><b>{s.provider}</b><div className={ui.sub}>{s.dataset}</div></td><td>{DOMAINS[s.domain]}</td><td><span className={ui.chip}>{EVIDENCE_LEVELS[s.level].code}</span></td>
          <td className={ui.sub}>{s.spatial} · {s.temporal} · {s.update}</td><td className={ui.sub}>{ENTITIES[s.mapsTo].label}</td><td className={ui.sub}>{s.license} · {s.commercialUse}</td><td className={ui.sub}>{s.featureState.replace(/_/g, " ")}</td></tr>)}
      </tbody></table></section>)}
      <p className={ui.sub}>Access terms and on/off state are managed in <Link href="/settings/integrations">Settings → Integrations</Link>; live health in <Link href="/intelligence/data?tab=health">Data → Health</Link>.</p></>}

    {tab === "packs" && await (async () => {
      const countries = await db.select({ c: projects.country }).from(projects).where(mandateCondition(user.scope, projects.mandateId));
      const active = new Map(activePacks(countries.map(x => x.c)).map(a => [a.pack.key, a.projects]));
      return <>{PACKS.map(p => <section key={p.key} className={r.panel}><p className={r.panelTitle}>{p.label} {active.has(p.key) ? <span className={`${ui.chip} ${ui.chipReed}`}>active · {active.get(p.key)} project(s)</span> : <span className={`${ui.chip} ${ui.chipMuted}`}>inactive (no project there)</span>}</p>
        {Object.entries(p.domains).map(([d, list]) => <div key={d}><b>{DOMAINS[d as keyof typeof DOMAINS] ?? d}</b><ul className={ui.sub}>{list.map(s => <li key={s.name}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>: {s.covers}{s.integrationKey ? " (connected)" : " (reference: check and record as evidence)"}</li>)}</ul></div>)}
      </section>)}</>;
    })()}

    {tab === "identity" && await (async () => {
      const ids = user.scope.mandateIds;
      const [aliases, edges] = ids.length ? await Promise.all([
        db.select().from(entityAliases).where(inArray(entityAliases.mandateId, ids)).orderBy(desc(entityAliases.createdAt)).limit(50),
        db.select().from(relationshipEdges).where(and(inArray(relationshipEdges.mandateId, ids))).orderBy(desc(relationshipEdges.createdAt)).limit(50),
      ]) : [[], []];
      return <div className={r.grid}>
        <section className={r.panel}><p className={r.panelTitle}>Recent identifiers</p>
          {aliases.length === 0 ? <p className={r.empty}>None yet. One Regenera record per real thing; names, LEIs, registry numbers and plant IDs map into it.</p> :
            <table className={ui.table}><thead><tr><th>Record</th><th>Scheme</th><th>Value</th><th>By</th></tr></thead><tbody>{aliases.map(a => <tr key={a.id}><td className={ui.sub}>{a.entityType} {a.entityId.slice(0, 8)}</td><td>{ALIAS_SCHEMES[a.scheme]}</td><td>{a.value}</td><td className={ui.sub}>{a.createdBy}</td></tr>)}</tbody></table>}
          <p className={r.panelTitle} style={{ marginTop: 24 }}>Recent relationships</p>
          {edges.length === 0 ? <p className={r.empty}>None yet.</p> :
            <table className={ui.table}><thead><tr><th>From</th><th>Relationship</th><th>To</th><th>Valid</th></tr></thead><tbody>{edges.map(e => <tr key={e.id}><td className={ui.sub}>{e.fromType} {e.fromId.slice(0, 8)}</td><td>{(PREDICATES as Record<string, { label: string }>)[e.type]?.label ?? e.type.replace(/_/g, " ")}</td><td className={ui.sub}>{e.toType} {e.toId.slice(0, 8)}</td><td className={ui.sub}>{e.validFrom ?? "…"} → {e.validTo ?? "…"}</td></tr>)}</tbody></table>}
        </section>
        <aside>
          <section className={r.panel}><p className={r.panelTitle}>Add an identifier</p>
            <form action={addAliasAction} className={r.form}><input type="hidden" name="back" value="/intelligence/ontology?tab=identity" />
              <label>Record type<select name="entityType"><option value="organization">Organization</option><option value="person">Person</option><option value="project">Project</option></select></label>
              <label>Record ID<input name="entityId" required placeholder="The record's ID (from its URL)" /></label>
              <label>Scheme<select name="scheme"><Opts o={ALIAS_SCHEMES} /></select></label><label>Value<input name="value" required /></label>
              <button className="btn" type="submit">Add</button></form></section>
          <section className={r.panel}><p className={r.panelTitle}>Record a typed relationship</p>
            <form action={addEdgeAction} className={r.form}><input type="hidden" name="back" value="/intelligence/ontology?tab=identity" />
              <label>Workspace<select name="mandateId">{ids.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
              <div className={r.formRow}><label>From type<select name="fromType">{ENTITY_TYPES.map(k => <option key={k} value={k}>{ENTITIES[k].label}</option>)}</select></label><label>From ID<input name="fromId" required /></label></div>
              <label>Relationship<select name="predicate">{PREDICATE_KEYS.map(k => <option key={k} value={k}>{PREDICATES[k].label}</option>)}</select></label>
              <div className={r.formRow}><label>To type<select name="toType">{ENTITY_TYPES.map(k => <option key={k} value={k}>{ENTITIES[k].label}</option>)}</select></label><label>To ID<input name="toId" required /></label></div>
              <div className={r.formRow}><label>Valid from<input type="date" name="validFrom" /></label><label>Valid to<input type="date" name="validTo" /></label></div>
              <label>Supporting claim ID (optional)<input name="evidenceClaimId" /></label><label>Note<input name="note" /></label>
              <button className="btn" type="submit">Record</button></form></section>
        </aside>
      </div>;
    })()}
  </>;
}

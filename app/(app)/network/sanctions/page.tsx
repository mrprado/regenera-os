import Link from "next/link";
import { and, desc, inArray, isNull, like } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contacts, organizations, sanctionsChecks } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { SANCTIONS_REVIEW } from "@/lib/ontology/taxonomies";
import { gateState, listStatus, RESCREEN_DAYS } from "@/lib/sanctions/engine";
import { refreshSanctionsAction, reviewSanctionsAction, screenAction } from "../../ontology-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sanctions screening" };

export default async function SanctionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/network/sanctions");
  const sp = await searchParams;
  const db = appDb();
  const q = (sp.q ?? "").trim();
  const [lists, checks, orgHits, personHits] = await Promise.all([
    listStatus(db),
    db.select().from(sanctionsChecks).where(mandateCondition(user.scope, sanctionsChecks.mandateId)).orderBy(desc(sanctionsChecks.createdAt)).limit(60),
    q.length >= 2 ? db.select({ id: organizations.id, name: organizations.name, country: organizations.country }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt), like(organizations.name, `%${q}%`))).limit(15) : Promise.resolve([]),
    q.length >= 2 ? db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(and(mandateCondition(user.scope, contacts.mandateId), like(contacts.fullName, `%${q}%`))).limit(15) : Promise.resolve([]),
  ]);
  const latestIds = new Set<string>();
  const latest = checks.filter(c => (latestIds.has(c.entityId) ? false : (latestIds.add(c.entityId), true)));
  const pending = latest.filter(c => gateState(c) === "pending");
  const loaded = lists.filter(l => l.entries > 0);
  const owner = isOwner(user.scope);
  const names = new Map<string, string>();
  const orgIds = latest.filter(c => c.entityType === "organization").map(c => c.entityId).slice(0, 90);
  if (orgIds.length) for (const o of await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds))) names.set(o.id, o.name);
  const back = "/network/sanctions";
  return <>
    <PageHeader title="Sanctions screening" count={pending.length || undefined} />
    <Notice text={sp.notice} />
    <p className={ui.notice}>Counterparties are checked against the OFAC, UK, EU and UN sanctions lists before an introduction, and on request. A possible match is a flag for a person to review, never an automatic decision: record it as a false positive or a confirmed match, with your reason. Records are re-screened after {RESCREEN_DAYS} days.</p>
    <div className={r.grid}>
      <section className={r.panel}>
        <p className={r.panelTitle}>Needs review ({pending.length})</p>
        {pending.length === 0 ? <p className={r.empty}>Nothing waiting.</p> : pending.map(c => <article key={c.id} className={r.read} style={{ marginTop: 10 }}>
          <b>{names.get(c.entityId) ?? c.name}</b> <span className={ui.sub}>{c.entityType} · screened {c.createdAt.slice(0, 10)} by {c.checkedBy}</span>
          <table className={ui.table}><thead><tr><th>Listed name</th><th>List · programme</th><th>Kind · country</th><th>Why it matched</th></tr></thead><tbody>
            {c.matches.map(m => <tr key={`${m.list}${m.listId}${m.name}`}><td>{m.name} <span className={ui.sub}>{m.listId}</span></td><td>{m.list.toUpperCase()} · {m.programme || "—"}</td><td>{m.kind} · {m.country || "—"}</td><td className={ui.sub}>{m.how}</td></tr>)}
          </tbody></table>
          {owner ? <form action={reviewSanctionsAction} className={r.form}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="back" value={back} />
            <label>Reason (what distinguishes or confirms it: date of birth, country, registration number…)<input name="reviewNote" required minLength={5} /></label>
            <div style={{ display: "flex", gap: 8, alignItems: "end" }}><label>Decision<select name="review" defaultValue="cleared"><option value="cleared">False positive</option><option value="confirmed">Confirmed match</option></select></label><button className={ui.miniBtn} type="submit">Record decision</button></div>
          </form> : <p className={ui.sub}>An owner records the decision.</p>}
        </article>)}

        <p className={r.panelTitle} style={{ marginTop: 24 }}>Screen a record</p>
        <form className={r.form} style={{ display: "flex", gap: 8, alignItems: "end" }}><label style={{ flex: 1 }}>Find an organization or person<input name="q" defaultValue={q} placeholder="Name" /></label><button className={ui.miniBtn} type="submit">Search</button></form>
        {(orgHits.length > 0 || personHits.length > 0) && <table className={ui.table}><tbody>
          {[...orgHits.map(o => ({ ...o, type: "organization" as const })), ...personHits.map(p => ({ ...p, country: null, type: "person" as const }))].map(x => <tr key={x.id}><td>{x.type === "organization" ? <Link href={`/companies/${x.id}`}>{x.name}</Link> : x.name}</td><td className={ui.sub}>{x.type}{x.country ? ` · ${x.country}` : ""}</td>
            <td><form action={screenAction}><input type="hidden" name="entityType" value={x.type} /><input type="hidden" name="entityId" value={x.id} /><input type="hidden" name="back" value={`${back}?q=${encodeURIComponent(q)}`} /><button className={ui.miniBtn} type="submit" disabled={!loaded.length}>Screen</button></form></td></tr>)}
        </tbody></table>}

        <p className={r.panelTitle} style={{ marginTop: 24 }}>Recent checks</p>
        {latest.length === 0 ? <p className={r.empty}>No checks yet.</p> :
          <table className={ui.table}><thead><tr><th>Record</th><th>Result</th><th>Lists</th><th>When</th></tr></thead><tbody>
            {latest.map(c => { const st = gateState(c); return <tr key={c.id}><td>{names.get(c.entityId) ?? c.name}<div className={ui.sub}>{c.entityType}</div></td>
              <td><span className={`${ui.chip} ${st === "clear" || st === "cleared" ? ui.chipReed : ui.chipEmber}`}>{st === "clear" ? "No match" : st === "pending" ? `${c.matches.length} possible` : SANCTIONS_REVIEW[st as "cleared" | "confirmed"]}</span>{c.reviewNote ? <div className={ui.sub}>{c.reviewNote} ({c.reviewedBy})</div> : null}</td>
              <td className={ui.sub}>{c.listsChecked.map(l => l.list.toUpperCase()).join(", ")}</td><td className={ui.sub}>{c.createdAt.slice(0, 10)}</td></tr>; })}
          </tbody></table>}
      </section>
      <aside><section className={r.panel}><p className={r.panelTitle}>Lists</p>
        <table className={ui.table}><tbody>{lists.map(l => <tr key={l.list}><td><a href={l.page} target="_blank" rel="noreferrer">{l.label}</a></td><td className={ui.num}>{l.entries ? l.entries.toLocaleString("en-US") : "—"}</td><td className={ui.sub}>{l.refreshedAt ? l.refreshedAt.slice(0, 10) : "not loaded"}</td></tr>)}</tbody></table>
        <p className={ui.sub}>Names and aliases, refreshed every Sunday. Free public downloads.</p>
        {owner && <form action={refreshSanctionsAction}><button className={ui.miniBtn} type="submit">Refresh all lists now</button></form>}
        {!loaded.length && <p className={ui.sub}>No list is loaded yet, so screening cannot run. Refresh the lists first.</p>}
      </section></aside>
    </div>
  </>;
}


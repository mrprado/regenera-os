import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { activities, capitalOpportunities, capitalStructures, contacts, contracts, deals, fundingPathways, organizations, projectParties, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { checkDealGate } from "@/lib/events/engine";
import { GATE_STATES } from "@/lib/capital/vocab";
import { PATHWAY_STATUSES, STRUCTURE_STATUSES } from "@/lib/capital/structure-vocab";
import { compactMoney } from "@/lib/projects/labels";
import { PARTY_ROLES } from "@/lib/projects/vocab";
import { DEAL_STAGES, ENGAGEMENTS, FEE_TYPES, LEAD_SOURCES } from "@/lib/vocab";
import { moveDeal, setNextAction } from "../actions";
import { createContractAction } from "../../contract-actions";
import { createProjectFromDealAction } from "../../project-actions";
import { GenerateMenu } from "@/components/generate-menu";
import { DealFlowPanels } from "./panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunity" };

const FLOW = ["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "expansion", "completed"] as const;

/** Opportunity detail (§12): overview, stage conditions, participants, capital, documents, commercial and activity. */
export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/deals/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [d] = await db.select().from(deals).where(and(eq(deals.id, id), mandateCondition(user.scope, deals.mandateId)));
  if (!d) notFound();
  const [org] = d.orgId ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, d.orgId)) : [];
  const [contact] = d.contactId ? await db.select({ id: contacts.id, name: contacts.fullName, title: contacts.title }).from(contacts).where(eq(contacts.id, d.contactId)) : [];
  const [project] = d.projectId ? await db.select({ id: projects.id, name: projects.name, country: projects.country, stage: projects.stage }).from(projects).where(eq(projects.id, d.projectId)) : [];
  const [agreements, log, parties, structures, pathways, capOpps] = await Promise.all([
    db.select({ id: contracts.id, title: contracts.title, lifecycle: contracts.lifecycle }).from(contracts).where(eq(contracts.dealId, id)),
    db.select().from(activities).where(eq(activities.dealId, id)).orderBy(desc(activities.occurredAt)).limit(40),
    project ? db.select({ role: projectParties.role, confirmed: projectParties.confirmed, orgName: organizations.name, orgId: projectParties.orgId }).from(projectParties).leftJoin(organizations, eq(organizations.id, projectParties.orgId)).where(eq(projectParties.projectId, project.id)) : Promise.resolve([]),
    project ? db.select().from(capitalStructures).where(eq(capitalStructures.projectId, project.id)) : Promise.resolve([]),
    project ? db.select().from(fundingPathways).where(eq(fundingPathways.projectId, project.id)) : Promise.resolve([]),
    project ? db.select({ id: capitalOpportunities.id, title: capitalOpportunities.title, gateState: capitalOpportunities.gateState }).from(capitalOpportunities).where(eq(capitalOpportunities.projectId, project.id)) : Promise.resolve([]),
  ]);
  // Conditions for the next stages on the flow (and the stage a blocked move tried to reach).
  const idx = FLOW.indexOf(d.stage as (typeof FLOW)[number]);
  const upcoming = [...new Set([...(sp.gate && sp.gate in DEAL_STAGES ? [sp.gate] : []), ...FLOW.slice(Math.max(0, idx + 1), idx + 4)])];
  const gates = await Promise.all(upcoming.map(async s => ({ stage: s, gate: await checkDealGate(db, id, s) })));
  const owner = isOwner(user.scope, d.mandateId);
  const back = `/deals/${id}`;

  return (
    <>
      <PageHeader title={d.name} actions={<><GenerateMenu entity="deal" id={d.id} /><Link className="btn" href="/deals">All opportunities</Link></>} />
      <Notice text={sp.notice} />
      {sp.gate && gates.find(g => g.stage === sp.gate && !g.gate.passed) && (
        <p className={ui.notice} role="alert">Not moved to {DEAL_STAGES[sp.gate as keyof typeof DEAL_STAGES]}: the stage conditions below are not met yet.{owner ? " An owner can override with a reason; the override is audited." : ""}</p>
      )}
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Overview</span><span className={ui.chip}>{DEAL_STAGES[d.stage]}</span></p>
            <dl className={r.kv}>
              <dt>Path</dt><dd>{d.path === "capital_mandate" ? "Capital mandate" : d.path === "project_diagnostic" ? "Project diagnostic" : "Partner network"}</dd>
              <dt>Engagement</dt><dd>{ENGAGEMENTS[d.engagement]} · {FEE_TYPES[d.feeType]}</dd>
              <dt>Value</dt><dd>{d.valueEstimate != null ? compactMoney(d.valueEstimate, "USD") : "Not estimated"}{d.monthlyValue ? ` · ${compactMoney(d.monthlyValue, "USD")}/month` : ""}{d.probability != null ? ` · ${d.probability}%` : ""}</dd>
              <dt>Expected close</dt><dd>{d.expectedClose ?? "Not set"}</dd>
              <dt>Source</dt><dd>{LEAD_SOURCES[d.source]}</dd>
              <dt>In stage since</dt><dd>{d.stageChangedAt.slice(0, 10)}</dd>
              {Object.keys(d.feeTerms).length > 0 && <><dt>Fee terms</dt><dd>{Object.entries(d.feeTerms).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}
              {d.notes && <><dt>Notes</dt><dd>{d.notes}</dd></>}
            </dl>
            <form action={setNextAction} className={r.form} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={d.id} />
              <label>Next action<input name="nextAction" defaultValue={d.nextAction ?? ""} /></label>
              <label>Date<input name="nextActionDate" type="date" defaultValue={d.nextActionDate ?? ""} /></label>
              <button className={ui.miniBtn} type="submit">Save next action</button>
            </form>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Stage conditions</p>
            <p className={ui.sub}>Each stage lists the conditions checked against records before a move. Where a stage shows &quot;No conditions&quot;, nothing is checked: the move is recorded with who and when.</p>
            {gates.map(({ stage, gate }) => (
              <div key={stage} style={{ marginTop: 10 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>To {DEAL_STAGES[stage as keyof typeof DEAL_STAGES]} {gate.gated ? (gate.passed ? <span className={ui.chipReed}>ready</span> : <span className={ui.chipEmber}>{gate.results.filter(x => !x.pass).length} open</span>) : <span className={ui.chipMuted}>No conditions for this stage</span>}</p>
                {gate.results.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>{gate.results.map(x => <li key={x.id}>{x.pass ? "✓" : "✗"} {x.text} <span className={ui.sub} style={{ display: "inline" }}>({x.detail})</span></li>)}</ul>}
                <form action={moveDeal} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                  <input type="hidden" name="id" value={d.id} /><input type="hidden" name="stage" value={stage} /><input type="hidden" name="back" value={back} />
                  {gate.gated && !gate.passed && owner && <><label className={ui.sub} style={{ display: "inline-flex", gap: 4 }}><input type="checkbox" name="override" /> Override</label><input name="reason" placeholder="Reason (10+ characters)" aria-label="Override reason" style={{ height: 28, border: "1px solid var(--line)", borderRadius: 6, padding: "0 8px", minWidth: 220 }} /></>}
                  <button className={ui.miniBtn} type="submit" disabled={gate.gated && !gate.passed && !owner}>Move to {DEAL_STAGES[stage as keyof typeof DEAL_STAGES]}</button>
                </form>
              </div>
            ))}
            <form action={moveDeal} style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} />
              <select name="stage" defaultValue="lost" aria-label="Close as">{(["lost", "nurture", "churned", "completed"] as const).map(k => <option key={k} value={k}>{DEAL_STAGES[k]}</option>)}</select>
              <button className={ui.miniBtn} type="submit">Close or park</button>
            </form>
          </section>

          <DealFlowPanels db={db} d={{ id: d.id, mandateId: d.mandateId, name: d.name, orgId: d.orgId }} />

          <section className={r.panel}>
            <p className={r.panelTitle}>Activity</p>
            {log.length === 0 ? <p className={r.empty}>No activity recorded.</p> : (
              <ul className={r.timeline}>{log.map(a => <li key={a.id}><span className={r.when}>{a.occurredAt.slice(0, 16).replace("T", " ")}</span><span className={r.what}>{a.type.replace(/_/g, " ")}{a.detail ? `: ${a.detail}` : ""}{a.actor ? ` · ${a.actor}` : ""}</span></li>)}</ul>
            )}
          </section>
        </div>

        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Participants</p>
            <dl className={r.kv}>
              <dt>Organization</dt><dd>{org ? <Link href={`/companies/${org.id}`}>{org.name}</Link> : "Not linked"}</dd>
              <dt>Contact</dt><dd>{contact ? <Link href={`/people/${contact.id}`}>{contact.name}</Link> : "Not linked"}{contact?.title ? ` · ${contact.title}` : ""}</dd>
              <dt>Project</dt><dd>{project ? <Link href={`/projects/${project.id}`}>{project.name}</Link> : <form action={createProjectFromDealAction} style={{ display: "inline" }}><input type="hidden" name="dealId" value={d.id} /><button className={ui.miniBtn} type="submit">Create and link project</button></form>}{project?.country ? ` · ${project.country}` : ""}</dd>
            </dl>
            {parties.length > 0 && <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>{parties.map((p, i) => <li key={i}>{PARTY_ROLES[p.role]}: {p.orgId ? <Link href={`/companies/${p.orgId}`}>{p.orgName}</Link> : "—"} {p.confirmed === "confirmed" ? "(confirmed)" : "(proposed)"}</li>)}</ul>}
          </section>

          {project && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Capital</p>
              {structures.length === 0 ? <p className={r.empty}>No capital structure. <Link href={`/projects/${project.id}?tab=stack`}>Build one</Link>.</p> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{structures.map(s => <li key={s.id}><Link href={`/projects/${project.id}?tab=stack&structure=${s.id}`}>{s.name}</Link> · {STRUCTURE_STATUSES[s.status]}</li>)}</ul>}
              {pathways.length > 0 && <><p className={ui.sub}><b>Funding pathways</b></p><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{pathways.map(p => <li key={p.id}>{p.name} · {PATHWAY_STATUSES[p.status]}{p.deadline ? ` · ${p.deadline}` : ""}</li>)}</ul></>}
              {capOpps.length > 0 && <><p className={ui.sub}><b>Capital opportunities (compliance gate)</b></p><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{capOpps.map(o => <li key={o.id}><Link href={`/capital/opportunities/${o.id}`}>{o.title}</Link> · {GATE_STATES[o.gateState]}</li>)}</ul></>}
            </section>
          )}

          <section className={r.panel}>
            <p className={r.panelTitle}>Agreements</p>
            {agreements.length === 0 ? <><p className={r.empty}>No engagement agreement yet.</p><form action={createContractAction}><input type="hidden" name="kind" value="engagement_letter" /><input type="hidden" name="source" value={`deal:${d.id}`} /><button className={ui.miniBtn} type="submit">Draft engagement letter</button></form><p className={ui.sub}>Drafts come from the counsel template with [TO CONFIRM] placeholders; nothing is sent.</p></> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{agreements.map(c => <li key={c.id}><Link href={`/contracts/${c.id}`}>{c.title}</Link> · {c.lifecycle.replace(/_/g, " ")}</li>)}</ul>}
          </section>
        </aside>
      </div>
    </>
  );
}

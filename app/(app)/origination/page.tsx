import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { engagements, impactRecords, originationHypotheses, originationItems, policyDecisions, projects, services, stewardshipObligations } from "@/db/schema";
import { CLASSIFICATION_LABEL, DECISION_STATE_LABEL, POLICY_V1 } from "@/lib/integrity/policy";
import { IMPACT_KINDS, indicatorByKey } from "@/lib/integrity/indicators";
import { completeObligationAction } from "../integrity-actions";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import { ORIGINATION_STAGES } from "@/lib/origination/engine";
import { READING_LABEL, TEMPLATES, WORK_PACKAGE } from "@/lib/origination/readiness";
import { CAPITAL_STAGES, ELIGIBILITY } from "@/lib/origination/eligibility";
import { READINESS_DIMENSIONS } from "@/lib/projects/vocab";
import { decideHypothesisAction, refreshOriginationAction, setOriginationStageAction } from "../origination-engine-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Origination" };

const ENTRANCES = { all: "All", capital_first: "Capital first", project_first: "Project first", market_first: "Market first" } as const;
const STRATEGY = { existing_project: "Existing project", site_asset: "Site & asset", needs_based: "Market need", funding_match: "Funding match", client_need: "Client need" } as const;
const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

export default async function OriginationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/origination");
  const sp = await searchParams;
  const tab = sp.tab ?? "queue";
  const entrance = (sp.entrance && sp.entrance in ENTRANCES ? sp.entrance : "all") as keyof typeof ENTRANCES;
  return (
    <>
      <PageHeader title="Origination" />
      <Notice text={sp.notice} />
      <p className={ui.notice}>One engine, three entrances: capital first (funding to eligible projects), project first (projects, sites and client needs to capital and partners) and market first (signals to hypotheses). Value figures are prioritization aids from service bands and evidence, never revenue. Nothing here contacts anyone.</p>
      <nav className={ui.tabs} aria-label="Origination views">
        {[["queue", "Queue"], ["hypotheses", "Hypotheses"], ["rubric", "Readiness rubric"], ["engines", "Revenue engines"], ["screening", "Integrity screening"], ["stewardship", "Stewardship"]].map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/origination?tab=${k}`}>{v}</Link>)}
      </nav>
      {tab === "queue" && <Queue scope={user.scope} entrance={entrance} />}
      {tab === "hypotheses" && <Hypotheses scope={user.scope} />}
      {tab === "rubric" && <Rubric />}
      {tab === "engines" && <Engines scope={user.scope} />}
      {tab === "screening" && <Screening scope={user.scope} state={sp.state} />}
      {tab === "stewardship" && <Stewardship scope={user.scope} />}
    </>
  );
}

async function Queue({ scope, entrance }: { scope: Scope; entrance: keyof typeof ENTRANCES }) {
  const rows = await appDb().select().from(originationItems).where(and(mandateCondition(scope, originationItems.mandateId), entrance === "all" ? undefined : eq(originationItems.entrance, entrance)))
    .orderBy(desc(originationItems.priority), asc(originationItems.createdAt)).limit(150);
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0 12px", flexWrap: "wrap" }}>
        {Object.entries(ENTRANCES).map(([k, v]) => <Link key={k} className={ui.chip} style={k === entrance ? { fontWeight: 700 } : undefined} href={`/origination?entrance=${k}`}>{v}</Link>)}
        <form action={refreshOriginationAction}><input type="hidden" name="back" value="/origination" /><button className={ui.miniBtn} type="submit">Refresh queue</button></form>
      </div>
      {rows.length === 0 ? <p className={r.empty}>Nothing queued yet. The queue rebuilds every 3 hours from funding matches, projects, site screens, hypotheses and open deals; or refresh now.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Opportunity</th><th>Entrance</th><th>Recommended service</th><th className={ui.num}>Expected value</th><th>Next action</th><th>Stage</th></tr></thead>
          <tbody>{rows.map(x => (
            <tr key={x.id}>
              <td className={ui.wrap}>{x.projectId ? <Link href={`/projects/${x.projectId}?tab=capital`}>{x.title}</Link> : x.orgId ? <Link href={`/companies/${x.orgId}`}>{x.title}</Link> : x.title}
                <span className={ui.sub}>{STRATEGY[x.strategy as keyof typeof STRATEGY]}</span></td>
              <td>{ENTRANCES[x.entrance as keyof typeof ENTRANCES]}</td>
              <td className={ui.wrap}>{x.recommendedService ?? "—"}<span className={ui.sub}>{x.serviceReason}</span></td>
              <td className={ui.num} title={x.valueBasis ?? ""}>{money(x.expectedValueUsd)}</td>
              <td className={ui.wrap}>{x.nextAction}{x.proposalId && <span className={ui.sub}><a href={`/api/documents/generated/${x.proposalId}`}>Proposal draft</a></span>}</td>
              <td><form action={setOriginationStageAction} style={{ display: "flex", gap: 4 }}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="back" value="/origination" />
                <select name="stage" defaultValue={x.stage} aria-label="Stage">{Object.entries(ORIGINATION_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={ui.miniBtn} type="submit">Set</button></form></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

async function Hypotheses({ scope }: { scope: Scope }) {
  const rows = await appDb().select().from(originationHypotheses).where(mandateCondition(scope, originationHypotheses.mandateId)).orderBy(desc(originationHypotheses.createdAt)).limit(60);
  return rows.length === 0 ? <p className={r.empty}>No hypotheses yet. One forms when three or more relevant signals cluster in a country and sector within 60 days.</p> : (
    <div style={{ display: "grid", gap: 14 }}>{rows.map(h => (
      <section key={h.id} className={r.panel}>
        <p className={r.panelTitle}>HYPOTHESIS · {h.title} <span className={ui.chip}>{h.status.replace("_", " ")}</span></p>
        <p>{h.thesis}</p>
        <p className={ui.sub}>Evidence ({h.evidence.length}):</p>
        <ul>{h.evidence.map(e => <li key={e.id} className={ui.sub}>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.label}</a> : e.label}{e.date ? ` · ${e.date}` : ""}</li>)}</ul>
        {h.counterparts.length > 0 && <p className={ui.sub}>Possible counterparts in Network: {h.counterparts.map(c => <Link key={c.orgId} href={`/companies/${c.orgId}`} style={{ marginRight: 8 }}>{c.name}</Link>)}</p>}
        <p className={ui.sub}>To validate: {h.validation.join(" · ")}</p>
        {h.status === "to_validate" || h.status === "validated" ? <div style={{ display: "flex", gap: 6 }}>
          {(["validated", "converted", "dismissed"] as const).filter(d => d !== h.status).map(d => <form key={d} action={decideHypothesisAction}><input type="hidden" name="id" value={h.id} /><input type="hidden" name="decision" value={d} /><button className={ui.miniBtn} type="submit">{d === "validated" ? "Mark validated" : d === "converted" ? "Convert to project" : "Dismiss"}</button></form>)}
        </div> : h.convertedProjectId ? <Link href={`/projects/${h.convertedProjectId}`}>Converted project</Link> : null}
      </section>
    ))}</div>
  );
}

function Rubric() {
  return (
    <>
      <p className={ui.notice}>Scoring per dimension: 0 not started or blocked · 1 early or in progress · 2 substantially ready · 3 ready, only with evidence (a status without evidence is capped at 1). Unknown is insufficient data, never favourable. A project needs at least 60% of its template dimensions scored to receive an overall reading; a critical dimension at 0 or unknown blocks it. Readings: {Object.values(READING_LABEL).join(" · ")}.</p>
      <p className={ui.sub}>Eligibility outcomes: {Object.values(ELIGIBILITY).join(" · ")}. Capital stages: {Object.values(CAPITAL_STAGES).join(" · ")}.</p>
      {TEMPLATES.map(t => (
        <section key={t.key} className={r.panel} style={{ marginTop: 12 }}>
          <p className={r.panelTitle}>{t.label}</p>
          <table className={ui.table}><thead><tr><th>Dimension</th><th>Weight</th><th>Critical</th><th>Evidence expected</th><th>Work package if weak</th></tr></thead>
            <tbody>{Object.entries(t.dims).map(([d, s]) => <tr key={d}><td>{READINESS_DIMENSIONS[d as keyof typeof READINESS_DIMENSIONS]}</td><td>{s!.weight}</td><td>{s!.critical ? "Yes" : ""}</td><td className={ui.wrap}>{s!.evidence}</td><td>{WORK_PACKAGE[d as keyof typeof WORK_PACKAGE] ?? "—"}</td></tr>)}</tbody></table>
        </section>
      ))}
    </>
  );
}

const DIVISIONS: [string, string[]][] = [
  ["Intelligence & AI systems", ["ai_systems_implementation", "managed_intelligence", "os_subscription", "market_intel"]],
  ["Origination & market access", ["market_access_retainer", "technology_commercialization", "project_diagnostic"]],
  ["Capital & investment readiness", ["funding_diagnostic", "funding_scan", "readiness_assessment", "investor_readiness", "capital_strategy", "capital_provider_screening"]],
  ["Development & execution", ["development_office", "development_management", "prefeasibility", "development_partnership"]],
];

async function Engines({ scope }: { scope: Scope }) {
  const db = appDb();
  const rows = await db.select({ status: engagements.status, fee: engagements.fee, monthlyFee: engagements.monthlyFee, workstreams: engagements.workstreams }).from(engagements).where(mandateCondition(scope, engagements.mandateId));
  const svc = await db.select({ key: services.key, name: services.name, low: services.bandLow, high: services.bandHigh, perMonth: services.perMonth }).from(services).where(mandateCondition(scope, services.mandateId));
  const live = new Set(["active", "contracting", "renewal", "waiting_on_client"]);
  const queue = await db.select({ svc: originationItems.recommendedService, n: sql<number>`count(*)`, v: sql<number>`coalesce(sum(${originationItems.expectedValueUsd}), 0)` }).from(originationItems).where(mandateCondition(scope, originationItems.mandateId)).groupBy(originationItems.recommendedService);
  return (
    <>
      <p className={ui.notice}>Recorded engagements only (no forecasts). Price bands are internal hypotheses to test with buyers. Capital introduction and placement-like work carries a legal gate; hypothetical project equity is never revenue.</p>
      {DIVISIONS.map(([label, keys]) => {
        const mine = rows.filter(e => (e.workstreams ?? []).some(k => keys.includes(k)));
        const active = mine.filter(e => live.has(e.status));
        return (
          <section key={label} className={r.panel} style={{ marginTop: 12 }}>
            <p className={r.panelTitle}>{label}</p>
            <p className={ui.sub}>{active.length} active · contracted one-time {money(active.reduce((s, e) => s + e.fee, 0))} · monthly {money(active.reduce((s, e) => s + e.monthlyFee, 0))} · {mine.length} engagements in total</p>
            <ul>{keys.map(k => { const s = svc.find(x => x.key === k); const q = queue.find(x => x.svc === k); return s ? <li key={k} className={ui.sub}>{s.name}: band {money(s.low)} to {money(s.high)}{s.perMonth ? " per month" : ""} · {q ? `${q.n} queued (${money(q.v)} expected)` : "none queued"}</li> : null; })}</ul>
          </section>
        );
      })}
    </>
  );
}

async function Screening({ scope, state }: { scope: Scope; state?: string }) {
  const db = appDb();
  const rows = await db.select({ d: policyDecisions, name: projects.name, country: projects.country }).from(policyDecisions).innerJoin(projects, eq(projects.id, policyDecisions.projectId))
    .where(and(mandateCondition(scope, policyDecisions.mandateId), eq(policyDecisions.current, true))).orderBy(desc(policyDecisions.createdAt)).limit(400);
  const counts = new Map<string, number>();
  for (const x of rows) counts.set(x.d.state, (counts.get(x.d.state) ?? 0) + 1);
  const shown = state ? rows.filter(x => x.d.state === state) : rows;
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}>Decisions by state</p>
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={`${ui.chip}`} href="/origination?tab=screening">All · {rows.length}</Link>
          {(Object.keys(DECISION_STATE_LABEL) as (keyof typeof DECISION_STATE_LABEL)[]).map(k => <Link key={k} className={ui.chip} href={`/origination?tab=screening&state=${k}`} style={{ fontWeight: state === k ? 600 : undefined }}>{DECISION_STATE_LABEL[k]} · {counts.get(k) ?? 0}</Link>)}
        </p>
        <p className={ui.sub}>Projects are screened every two hours (new or due for review) under the current policy. Excluded and human-review projects cannot receive a proposal, outreach or capital introduction until an owner overrides with a reason.</p>
      </section>
      <section className={r.panel}>
        {shown.length === 0 ? <p className={r.empty}>No screened projects{state ? " in this state" : " yet"}.</p> : (
          <table className={ui.table}><thead><tr><th>Project</th><th>Decision</th><th>Classification</th><th>Confidence</th><th>Outstanding</th><th>Review</th></tr></thead><tbody>{shown.map(x => (
            <tr key={x.d.id}><td><Link href={`/projects/${x.d.projectId}?tab=capital#integrity`}>{x.name}</Link><span className={ui.sub}>{x.country ?? ""}</span></td>
              <td>{DECISION_STATE_LABEL[x.d.state]}{x.d.overrides.length ? " (overridden)" : ""}</td><td>{CLASSIFICATION_LABEL[x.d.classification]}</td><td>{x.d.confidence}</td>
              <td className={ui.wrap}><span className={ui.sub}>{x.d.outstanding.slice(0, 2).join("; ")}{x.d.outstanding.length > 2 ? ` +${x.d.outstanding.length - 2}` : ""}</span></td><td>{x.d.nextReviewAt?.slice(0, 10) ?? ""}</td></tr>
          ))}</tbody></table>
        )}
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}>Policy v1 (published on first use; later versions never rewrite earlier decisions)</p>
        <p className={ui.sub}><b>Exclusions:</b> {POLICY_V1.exclusions.map(e => e.key.replace(/_/g, " ")).join("; ")}.</p>
        <p className={ui.sub}><b>Sector classes:</b> {POLICY_V1.sectorClasses.map(s => `${s.method} → ${CLASSIFICATION_LABEL[s.classification]}`).join("; ")}.</p>
        <p className={ui.sub}>Protected areas within {POLICY_V1.protectedNearKm} km trigger enhanced due diligence; overlap requires redesign unless the project is itself conservation or restoration. Commercial inputs are not read by these rules.</p>
      </section>
    </>
  );
}

async function Stewardship({ scope }: { scope: Scope }) {
  const db = appDb();
  const [obl, imp] = await Promise.all([
    db.select({ o: stewardshipObligations, name: projects.name }).from(stewardshipObligations).innerJoin(projects, eq(projects.id, stewardshipObligations.projectId))
      .where(mandateCondition(scope, stewardshipObligations.mandateId)).orderBy(asc(stewardshipObligations.dueAt)).limit(200),
    db.select({ i: impactRecords, name: projects.name }).from(impactRecords).innerJoin(projects, eq(projects.id, impactRecords.projectId))
      .where(mandateCondition(scope, impactRecords.mandateId)).orderBy(desc(impactRecords.createdAt)).limit(100),
  ]);
  const open = obl.filter(x => x.o.status === "open" || x.o.status === "overdue");
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}>Obligations due · {open.length} open ({open.filter(x => x.o.status === "overdue").length} overdue)</p>
        {open.length === 0 ? <p className={r.empty}>No open stewardship obligations. Add them on a project&apos;s Capital tab once agreed.</p> : (
          <table className={ui.table}><tbody>{open.map(x => (
            <tr key={x.o.id}><td><Link href={`/projects/${x.o.projectId}?tab=capital#integrity`}>{x.name}</Link></td><td>{x.o.title}<span className={ui.sub}>{x.o.kind.replace(/_/g, " ")}{x.o.owner ? ` · ${x.o.owner}` : ""}</span></td>
              <td>{x.o.dueAt?.slice(0, 10) ?? "no date"}</td><td>{x.o.status}</td>
              <td><form action={completeObligationAction} style={{ display: "flex", gap: 4 }}><input type="hidden" name="id" value={x.o.id} /><input type="hidden" name="back" value="/origination?tab=stewardship" /><input name="evidence" placeholder="Evidence" aria-label="Evidence" required /><button className="btn" type="submit">Done</button></form></td></tr>
          ))}</tbody></table>
        )}
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}>Impact records</p>
        {imp.length === 0 ? <p className={r.empty}>No impact records yet. Baselines, forecasts, targets, reported and independently verified values are kept apart.</p> : (
          <table className={ui.table}><tbody>{imp.map(x => (
            <tr key={x.i.id}><td><Link href={`/projects/${x.i.projectId}?tab=capital#integrity`}>{x.name}</Link></td><td>{indicatorByKey(x.i.indicator)?.label ?? x.i.indicator}</td><td>{IMPACT_KINDS[x.i.kind]}</td><td className={ui.num}>{x.i.value ?? "—"} {x.i.unit}</td><td><span className={ui.sub}>{x.i.source}</span></td></tr>
          ))}</tbody></table>
        )}
      </section>
    </>
  );
}

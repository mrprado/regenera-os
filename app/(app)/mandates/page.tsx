import Link from "next/link";
import { Target } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal } from "@/lib/db/scoped";
import { withBase } from "@/lib/base-path";
import { day, label, money } from "@/lib/mandates/format";
import { mandateCommand, mandatesFor, publicMetrics } from "@/lib/mandates/queries";
import { BREADTH, BUILDER, CADENCE, CONFIDENTIALITY, DELIVERY_METRICS, DESKS, ENGAGEMENT_MODELS, HEALTH, MANDATE_STATUSES, MANDATE_TYPES, OUTREACH_PERMISSION, SUCCESS_STRUCTURES, type MandateType } from "@/lib/mandates/vocab";
import { createMandateAction, loadPreparedMandatesAction } from "../origination-actions";
import f from "../funding/funding.module.css";
import s from "./mandates.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mandates" };

export default async function MandatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/mandates");
  const sp = await searchParams;
  const db = appDb();
  const rows = await mandatesFor(db, user.scope, { type: sp.type, status: sp.status, desk: sp.desk, q: sp.q });
  const cmd = await mandateCommand(db, user.scope);
  const internal = isInternal(user.scope);
  const pm = internal ? await publicMetrics(db, user.scope) : null;
  const newType = (sp.new && sp.new in MANDATE_TYPES ? sp.new : null) as MandateType | null;

  return (
    <>
      <PageHeader title="Mandates" count={rows.length} actions={<Link className="btn" href="/mandates?new=epc_origination">New mandate</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>A mandate is what Regenera, or a client through Regenera, is being asked to accomplish. Everything else points back to one: the universe is screened against its written criteria, the client approves pursuits by name (which fixes attribution), and delivery is measured against its floor. Machine screening stops at pre-qualified; a person qualifies.</p>

      <dl className={f.strip}>
        <div><dt>Active mandates</dt><dd>{cmd.active.length}</dd></div>
        {internal && <div><dt>Retainer MRR</dt><dd>{money(cmd.mrr)}</dd></div>}
        <div><dt>Open pursuits</dt><dd><Link href="/pursuits">{cmd.pursuits.length}</Link></dd></div>
        <div><dt>Pursuit pipeline</dt><dd>{money(cmd.pipeline)}<span className={ui.sub}>weighted {money(cmd.weighted)}</span></dd></div>
        <div><dt>Awaiting client decision</dt><dd>{cmd.awaitingClient}</dd></div>
        <div><dt>Approvals pending</dt><dd><Link href="/approvals">{cmd.pending.length}</Link></dd></div>
        <div><dt>New signals</dt><dd>{cmd.signals.length}</dd></div>
        <div><dt>At risk</dt><dd className={cmd.atRisk.length ? f.warn : ""}>{cmd.atRisk.length}</dd></div>
      </dl>

      {newType ? <Builder type={newType} /> : null}

      <form action={withBase("/mandates")} className={f.inline} style={{ margin: "0 0 12px" }}>
        <input name="q" defaultValue={sp.q} placeholder="Mandate or client" aria-label="Search mandates" />
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Type"><option value="">All types</option>{Object.entries(MANDATE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="desk" defaultValue={sp.desk ?? ""} aria-label="Desk"><option value="">All desks</option>{Object.entries(DESKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All statuses</option>{Object.entries(MANDATE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
        {internal && <Link href="/mandates/desks" className={ui.clear}>Desks & economics</Link>}
      </form>
      {internal && !rows.some(r => r.m.name.startsWith("EMC Renewables")) && <form action={loadPreparedMandatesAction} style={{ margin: "0 0 12px" }}><button className="btn" type="submit">Load prepared mandates (EMC pilot, RA-ESG)</button></form>}

      {rows.length === 0 ? <EmptyState icon={Target} title="No mandates yet" body="Create a mandate with its written criteria, qualification definition, delivery floor and economics; then build its universe." actions={<Link className="btn" href="/mandates?new=epc_origination">New mandate</Link>} /> : (
        <div className={s.portfolio}>
          {rows.map(({ m, universe, matched, preQualified, qualified, approved, pursuitsOpen, won }) => (
            <section key={m.id} className={s.tile}>
              <div className={f.inline}><span className={s.reading} data-r={m.health}>{HEALTH[m.health as keyof typeof HEALTH] ?? m.health}</span><span className={s.reading}>{MANDATE_STATUSES[m.status as keyof typeof MANDATE_STATUSES] ?? m.status}</span>{m.priority === "high" || m.priority === "critical" ? <span className={s.reading} data-r="watch">{m.priority}</span> : null}</div>
              <h3><Link href={`/mandates/${m.id}`}>{m.name}</Link></h3>
              <div className={s.tileMeta}>{MANDATE_TYPES[m.type as MandateType]?.label} · {DESKS[m.desk as keyof typeof DESKS] ?? m.desk}{m.clientName ? ` · ${m.clientName}` : ""}{m.owner ? ` · ${m.owner}` : ""}</div>
              <div className={s.tileStats}><div><b>{universe}</b>universe</div><div><b>{preQualified}</b>pre-qualified</div><div><b>{qualified}</b>qualified</div><div><b>{approved}</b>approved</div></div>
              <div className={s.tileMeta}>{matched} matched · {pursuitsOpen} open pursuits{won ? ` · ${won} won` : ""}{internal && (m.retainer || m.pilotFee) ? ` · ${m.pilotFee ? `pilot ${money(m.pilotFee)}` : ""}${m.pilotFee && m.retainer ? " → " : ""}${m.retainer ? `${money(m.retainer)}/mo` : ""}` : ""}{m.successEconomics.structure && m.successEconomics.structure !== "none" ? ` · ${SUCCESS_STRUCTURES[m.successEconomics.structure]}` : ""}</div>
              {m.deliveryFloor.length > 0 && <div className={s.tileMeta}>Floor: {m.deliveryFloor.map(x => `${x.target} ${DELIVERY_METRICS[x.metric].label.toLowerCase()}`).join(" · ")}</div>}
              {m.nextAction && <div className={s.next}>{m.nextAction}{m.nextActionDate ? ` · ${day(m.nextActionDate)}` : ""}</div>}
              {m.healthNote && <div className={s.caution}>{m.healthNote}</div>}
            </section>
          ))}
        </div>
      )}

      {pm && (
        <>
          <h3 className={f.kicker}>Public proof metrics (anonymized, record-backed)</h3>
          <dl className={f.strip}>
            <div><dt>Active mandates</dt><dd>{pm.activeMandates}</dd></div>
            <div><dt>Queue positions monitored</dt><dd>{pm.projectsMonitored.toLocaleString("en-US")}</dd></div>
            <div><dt>Capacity monitored</dt><dd>{pm.capacityMonitoredMw.toLocaleString("en-US")} MW</dd></div>
            <div><dt>Candidates screened</dt><dd>{pm.candidates.toLocaleString("en-US")}</dd></div>
            <div><dt>Qualified (human)</dt><dd>{pm.qualified}</dd></div>
          </dl>
          <p className={ui.sub}>Publishable live-mandate lines (approved per mandate): {pm.publishable.length ? pm.publishable.join(" · ") : "none approved yet"}. Nothing is published from here; this is what a public page may show.</p>
        </>
      )}
    </>
  );
}

function Builder({ type }: { type: MandateType }) {
  const fields = BUILDER[type];
  return (
    <section style={{ borderTop: "1px solid var(--line)", padding: "14px 0 18px", marginBottom: 16 }}>
      <h3 className={f.kicker}>New mandate</h3>
      <nav className={f.inline} style={{ marginBottom: 10 }}>{Object.entries(MANDATE_TYPES).map(([k, v]) => <Link key={k} href={`/mandates?new=${k}`} className={s.reading} data-r={k === type ? "strong" : undefined}>{v.label}</Link>)}</nav>
      <p className={ui.sub}>{MANDATE_TYPES[type].side}. Fields below are the criteria for this mandate type; the qualification definition is fixed per type and recorded per candidate.</p>
      <form action={createMandateAction} className={f.grid3}>
        <input type="hidden" name="type" value={type} />
        <label className={f.full}>Mandate name<input name="name" required placeholder="e.g. U.S. utility-scale PV + BESS EPC origination pilot" /></label>
        <label>Client<input name="clientName" placeholder="Client name (or Regenera)" /></label>
        <label>Client entity<input name="clientEntity" /></label>
        <label>Mandate owner<input name="owner" placeholder="email" /></label>
        <label>Mandate lead<input name="lead" placeholder="email" /></label>
        <label>Originator<input name="originator" /></label>
        <label>Status<select name="status" defaultValue="draft">{Object.entries(MANDATE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {fields.map(c => (
          <label key={c.key} className={c.kind === "text" ? f.full : undefined}>{c.label}{c.unit ? ` (${c.unit})` : ""}{c.kind === "select"
            ? <select name={`c_${c.key}`} defaultValue=""><option value="">—</option>{c.options!.map(o => <option key={o} value={o}>{label(o)}</option>)}</select>
            : <input name={`c_${c.key}`} placeholder={c.hint ?? (c.kind === "list" ? "comma-separated" : "")} inputMode={c.kind === "number" || c.kind === "months" ? "decimal" : undefined} />}</label>
        ))}
        <label className={f.full}>Exclusions<textarea name="exclusions" placeholder="e.g. projects with an awarded EPC; sub-scale distributed generation; markets the client cannot execute in" /></label>
        <label className={f.full}>Qualification definition (client&rsquo;s words)<textarea name="qualificationNote" placeholder="What counts as a qualified opportunity for this client" /></label>
        <label className={f.full}>Success definition<textarea name="successDefinition" /></label>
        <label>Engagement model<select name="engagementModel" defaultValue="pilot">{Object.entries(ENGAGEMENT_MODELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Mandate breadth<select name="breadth" defaultValue="regional">{Object.entries(BREADTH).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Term (months)<input name="termMonths" inputMode="decimal" /></label>
        <label>Pilot / fixed fee<input name="pilotFee" inputMode="decimal" /></label>
        <label>Retainer per month<input name="retainer" inputMode="decimal" /></label>
        <label>Implementation fee<input name="implementationFee" inputMode="decimal" /></label>
        <label>Success structure<select name="successStructure" defaultValue="none">{Object.entries(SUCCESS_STRUCTURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Rate (%)<input name="successRate" inputMode="decimal" /></label>
        <label>Fixed amount<input name="successAmount" inputMode="decimal" /></label>
        <label>Cap per event<input name="successCap" inputMode="decimal" /></label>
        <label>Attribution window (months)<input name="attributionWindow" inputMode="decimal" defaultValue="18" /></label>
        <label>Payment event<input name="paymentEvent" placeholder="e.g. EPC contract execution" /></label>
        <label className={f.full}>Attribution rules<textarea name="attributionRules" defaultValue="Regenera originated: Regenera discovered the opportunity and initiated the pathway, and the client approved it by name. Client originated: the client marked it Already known, or it is on the pre-existing account list; no success fee. Regenera assisted / jointly originated: per contract." /></label>
        <label>Outreach permission<select name="outreachPermission" defaultValue="approval_each">{Object.entries(OUTREACH_PERMISSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Confidentiality<select name="confidentiality" defaultValue="confidential">{Object.entries(CONFIDENTIALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Reporting cadence<select name="reportingCadence" defaultValue="weekly">{Object.entries(CADENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <p className={`${f.full} ${f.kicker}`}>Delivery floor per month (targets; delivered is counted from records)</p>
        {Object.entries(DELIVERY_METRICS).map(([k, v]) => <label key={k}>{v.label}<span className={ui.sub}>{v.level}</span><input name={`floor_${k}`} inputMode="numeric" /></label>)}
        <label className={f.full}>Compliance requirements<textarea name="complianceRequirements" placeholder="Jurisdictions, recipient types, securities / broker considerations, consent basis" /></label>
        <label className={f.full}>Legal restrictions<textarea name="legalRestrictions" /></label>
        <label className={f.full}>Next action<input name="nextAction" /></label>
        <div className={f.full}><button className="btn btn-primary" type="submit">Create mandate</button> <Link href="/mandates" className={ui.clear}>Cancel</Link></div>
      </form>
    </section>
  );
}

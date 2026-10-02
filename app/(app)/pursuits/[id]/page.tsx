import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { day, label, money } from "@/lib/mandates/format";
import { pursuitDetail } from "@/lib/mandates/queries";
import { APPROVAL_KINDS, APPROVAL_STATUSES, ATTRIBUTION, BID_CRITERIA, BID_DECISIONS, BID_RATINGS, flowFor, PURSUIT_OUTCOMES, PURSUIT_TYPES, type PursuitType } from "@/lib/mandates/vocab";
import { bidCriteriaAction, closePursuitAction, decideBidAction, movePursuitAction, probabilityAction, requestApprovalAction, updatePursuitAction } from "../../origination-actions";
import f from "../../funding/funding.module.css";
import s from "../../mandates/mandates.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pursuit" };

const TABS = [["overview", "Overview"], ["bid", "Bid / no-bid"], ["approvals", "Approvals"], ["outcome", "Outcome & learning"]] as const;

export default async function PursuitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/pursuits");
  const { id } = await params;
  const sp = await searchParams;
  const d = await pursuitDetail(appDb(), user.scope, id);
  if (!d) notFound();
  const { p, m, c, approvals, docs, prob } = d;
  const flow = flowFor(p.type as PursuitType);
  const idx = flow.findIndex(x => x.key === p.stage);
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";

  return (
    <>
      <PageHeader title={p.name} />
      <Notice text={sp.notice} />
      <p className={ui.sub}>{PURSUIT_TYPES[p.type as PursuitType]}{m ? <> · <Link href={`/mandates/${m.id}`}>{m.name}</Link></> : ""}{c ? <> · <Link href={`/mandates/candidates/${c.id}`}>candidate record</Link></> : ""}{p.projectId ? <> · <Link href={`/projects/${p.projectId}`}>project</Link></> : ""} · {ATTRIBUTION[p.attribution as keyof typeof ATTRIBUTION]?.label} · {PURSUIT_OUTCOMES[p.outcome as keyof typeof PURSUIT_OUTCOMES]}</p>
      <div className={s.stagebar}>{flow.map((st, i) => <span key={st.key} data-on={i < idx ? "done" : i === idx ? "current" : undefined}>{st.label}</span>)}</div>
      <nav className={ui.tabs} aria-label="Pursuit views">{TABS.map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/pursuits/${p.id}${k === "overview" ? "" : `?tab=${k}`}`}>{v}</Link>)}</nav>

      {tab === "overview" && (
        <div className={f.layout}>
          <div>
            <form action={movePursuitAction} className={f.inline} style={{ marginBottom: 14 }}>
              <input type="hidden" name="id" value={p.id} />
              <select name="to" defaultValue={flow[Math.min(idx + 1, flow.length - 1)]?.key} aria-label="Stage">{flow.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}</select>
              <input name="reason" placeholder="Why (required)" aria-label="Reason" />
              <input name="evidence" placeholder="Evidence (email, RFP ref, meeting)" aria-label="Evidence" />
              <button className="btn" type="submit">Change stage</button>
            </form>
            <form action={updatePursuitAction} className={f.grid2}>
              <input type="hidden" name="id" value={p.id} />
              <label>Owner<input name="owner" defaultValue={p.owner ?? ""} /></label>
              <label>Relationship status<select name="relationshipStatus" defaultValue={p.relationshipStatus}>{["none", "identified", "contacted", "engaged", "trusted"].map(x => <option key={x}>{x}</option>)}</select></label>
              <label className={f.full}>Next action<input name="nextAction" defaultValue={p.nextAction} /></label>
              <label>Next action date<input type="date" name="nextActionDate" defaultValue={p.nextActionDate ?? ""} /></label>
              <label>Expected date<input type="date" name="expectedDate" defaultValue={p.expectedDate ?? ""} /></label>
              <label>Value<input name="value" defaultValue={p.value ?? ""} /></label>
              <label>Value basis<input name="valueBasis" defaultValue={p.valueBasis} /></label>
              <label className={f.full}>Expected outcome<input name="expectedOutcome" defaultValue={p.expectedOutcome} /></label>
              <label className={f.full}>Decision makers (one per line: Name — role)<textarea name="decisionMakers" defaultValue={p.decisionMakers.map(x => `${x.name} — ${x.role}`).join("\n")} /></label>
              <label>Risks (comma-separated)<textarea name="risks" defaultValue={p.risks.join(", ")} /></label>
              <label>Competitors<textarea name="competitors" defaultValue={p.competitors.join(", ")} /></label>
              <label className={f.full}>Commercial structure<input name="commercialStructure" defaultValue={p.commercialStructure} /></label>
              <div className={f.full}><button className="btn btn-primary" type="submit">Save</button></div>
            </form>
            <h3 className={f.kicker} style={{ marginTop: 18 }}>History</h3>
            {p.stageHistory.slice().reverse().map((h, i) => <p key={i} className={ui.sub}>{day(h.at)} · {label(h.from) || "—"} → {label(h.to)} · {h.by}: {h.reason}{h.evidence ? ` (evidence: ${h.evidence})` : ""}</p>)}
          </div>
          <aside className={f.aside}>
            <h3>Value</h3><p>{money(p.value)}<span className={ui.sub}>{p.valueBasis}</span></p>
            <h3>Probability</h3><p>{prob.effective}% <span className={ui.sub}>{prob.overridden ? `Override by a person: ${p.probabilityWhy} (${day(p.probabilityAt)}). Stage default ${prob.base}%.` : `Stage default for ${label(p.stage)}; no override.`}</span></p>
            <form action={probabilityAction} className={f.form}><input type="hidden" name="id" value={p.id} /><input name="value" placeholder="Override 0–100" aria-label="Override" /><input name="why" placeholder="Why (required)" aria-label="Why" /><span className={f.inline}><button className="btn" type="submit">Set</button>{prob.overridden && <button className="btn" type="submit" name="clear" value="1">Clear override</button>}</span></form>
            <h3>Weighted value</h3><p>{money((p.value ?? 0) * prob.effective / 100)}</p>
            <h3>Documents</h3>{docs.length ? docs.map(x => <p key={x.id} className={ui.sub}><Link href={`/documents/${x.id}`}>{x.name}</Link> · {label(x.category)}</p>) : <p className={ui.sub}>No project documents linked.</p>}
            <h3>Diligence / documents</h3><p>{label(p.diligenceStatus)} · {label(p.documentStatus)}</p>
          </aside>
        </div>
      )}

      {tab === "bid" && (
        <>
          <p className={ui.notice}>Every criterion is rated by a person with a note. A Go is refused while any criterion is a blocker; use Conditional go and state the conditions. The decision is recorded as an approval with its rationale.</p>
          {p.bidDecision && <p><span className={s.reading} data-r={p.bidDecision === "go" ? "strong" : p.bidDecision === "no_bid" ? "fail" : "partial"}>{BID_DECISIONS[p.bidDecision as keyof typeof BID_DECISIONS]}</span> by {p.bidDecidedBy} on {day(p.bidDecidedAt)}: {p.bidRationale}</p>}
          <form action={bidCriteriaAction}>
            <input type="hidden" name="id" value={p.id} />
            <div className={ui.tableWrap}><table className={ui.table}>
              <thead><tr><th>Criterion</th><th>Rating</th><th>Note / evidence</th></tr></thead>
              <tbody>{Object.entries(BID_CRITERIA).map(([k, v]) => <tr key={k}><td>{v}</td><td><select name={`r_${k}`} defaultValue={p.bidCriteria[k]?.rating ?? "unknown"} aria-label={v}>{Object.entries(BID_RATINGS).map(([rk, rv]) => <option key={rk} value={rk}>{rv}</option>)}</select></td><td><input name={`n_${k}`} defaultValue={p.bidCriteria[k]?.note ?? ""} style={{ width: "100%" }} aria-label={`${v} note`} /></td></tr>)}</tbody>
            </table></div>
            <p><button className="btn" type="submit">Save ratings</button></p>
          </form>
          <form action={decideBidAction} className={f.form} style={{ maxWidth: 680 }}>
            <input type="hidden" name="id" value={p.id} />
            <label>Decision<select name="decision" defaultValue="conditional_go">{Object.entries(BID_DECISIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Rationale and evidence (required)<textarea name="rationale" /></label>
            <div><button className="btn btn-primary" type="submit">Record decision</button></div>
          </form>
        </>
      )}

      {tab === "approvals" && (
        <>
          <div className={ui.tableWrap}><table className={ui.table}>
            <thead><tr><th>Approval</th><th>Requester</th><th>Approver</th><th>Status</th><th>Rationale / conditions</th><th>Decided</th></tr></thead>
            <tbody>{approvals.map(a => <tr key={a.id}><td>{a.title}<span className={ui.sub}>{APPROVAL_KINDS[a.kind as keyof typeof APPROVAL_KINDS]}</span></td><td>{a.requester}</td><td>{a.approver ?? "Any owner"}</td><td><span className={s.reading} data-r={a.status}>{APPROVAL_STATUSES[a.status as keyof typeof APPROVAL_STATUSES]}</span></td><td className={ui.wrap}>{a.rationale}{a.conditions ? <span className={ui.sub}>Conditions: {a.conditions}</span> : null}</td><td>{a.decidedBy ? `${a.decidedBy} · ${day(a.decidedAt)}` : "—"}</td></tr>)}</tbody>
          </table></div>
          <h3 className={f.kicker} style={{ marginTop: 14 }}>Request an approval</h3>
          <form action={requestApprovalAction} className={f.grid3}>
            <input type="hidden" name="entityType" value="pursuits" /><input type="hidden" name="entityId" value={p.id} /><input type="hidden" name="cm" value={p.commercialMandateId ?? ""} /><input type="hidden" name="back" value={`/pursuits/${p.id}?tab=approvals`} />
            <label>Kind<select name="kind" defaultValue="outreach">{Object.entries(APPROVAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Approver (email)<input name="approver" /></label>
            <label>Document version<input name="documentVersion" /></label>
            <label className={f.full}>Title<input name="title" placeholder="What exactly is being approved" /></label>
            <label className={f.full}>Detail<textarea name="detail" /></label>
            <div className={f.full}><button className="btn" type="submit">Request approval</button></div>
          </form>
        </>
      )}

      {tab === "outcome" && (
        <>
          {p.outcome !== "open" && p.outcome !== "no_bid" ? <div className={f.brief}>{Object.entries(p.winLoss).map(([k, v]) => `${label(k)}: ${v}`).join("\n")}</div> : (
            <form action={closePursuitAction} className={f.grid2}>
              <input type="hidden" name="id" value={p.id} />
              <label>Outcome<select name="outcome" defaultValue="won"><option value="won">Won / awarded</option><option value="lost">Lost</option><option value="stalled">Stalled</option><option value="withdrawn">Withdrawn</option></select></label>
              <label>Value (final)<input name="value" /></label>
              <label className={f.full}>Why (required)<textarea name="reason" /></label>
              {["competitor", "pricing", "timing", "relationship", "technical", "financial", "risk", "clientFeedback", "lessons", "followUp"].map(k => <label key={k}>{label(k)}<input name={k} /></label>)}
              <div className={f.full}><button className="btn btn-primary" type="submit">Record outcome</button></div>
            </form>
          )}
          <p className={ui.sub} style={{ marginTop: 10 }}>Outcomes feed institutional learning: which criteria, signals and sources preceded wins and losses. No statistic is reported until the sample is large enough to mean something.</p>
        </>
      )}
    </>
  );
}

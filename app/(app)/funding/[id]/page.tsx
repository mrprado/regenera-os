import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { amount, daysLabel, daysLeft, ROUTE_LABEL, SOURCE_LABEL } from "@/lib/funding/labels";
import { getOpportunity } from "@/lib/funding/queries";
import { DEAL_STAGES, SECTORS } from "@/lib/vocab";
import { bidAction, decideFundingAction, draftProposalAction, findApplicantsAction, offerSupportAction } from "../../funding-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funding opportunity" };

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/funding");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getOpportunity(user.scope, id);
  if (!data) notFound();
  const { o, matches, deal } = data;
  const d = daysLeft(o.deadline);
  const proposal = o.read?.proposal;

  return (
    <>
      <PageHeader title={o.title} actions={<Link className="btn" href="/funding">All funding</Link>} />
      <Notice text={sp.notice} />
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>{o.funder ?? "Funder not stated"}</span><span className={ui.chip}>{o.type} · {o.status}</span></p>
            {o.read?.summary ? <p className={ui.read}>{o.read.summary}</p> : <p className={r.empty}>Not read by Claude yet. The fit shown is a keyword estimate.</p>}
            {o.read?.why && <p style={{ fontSize: 13.5, margin: "8px 0 0" }}>{o.read.why}</p>}
            {o.read?.caveats?.length ? <ul style={{ fontSize: 13, margin: "8px 0 0", paddingLeft: 18 }}>{o.read.caveats.map(c => <li key={c}>{c}</li>)}</ul> : null}
            <div className={ui.rowActions} style={{ marginTop: 12 }}>
              {!o.dealId && <form action={bidAction}><input type="hidden" name="id" value={o.id} /><button className="btn btn--primary" type="submit">Bid</button></form>}
              <form action={findApplicantsAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">Find applicants</button></form>
              <form action={draftProposalAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">{proposal ? "Redraft proposal" : "Draft proposal sections"}</button></form>
              {o.decision !== "watching" && !o.dealId && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="watching" /><input type="hidden" name="back" value={`/funding/${o.id}`} /><button className="btn" type="submit">Watch</button></form>}
              {o.decision !== "dismissed" && !o.dealId && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="dismissed" /><input type="hidden" name="back" value="/funding" /><button className="btn" type="submit">Dismiss</button></form>}
              <a className="btn" href={o.url} target="_blank" rel="noreferrer">Open the call</a>
            </div>
          </section>

          {deal && (
            <section className={r.panel}>
              <p className={r.panelTitle}><span>Bid</span><Link href="/deals?view=table">Deals</Link></p>
              <dl className={r.kv}>
                <dt>Stage</dt><dd>{DEAL_STAGES[deal.stage as keyof typeof DEAL_STAGES]}</dd>
                <dt>Next action</dt><dd>{deal.nextAction ?? "—"} {deal.nextActionDate ? `(${deal.nextActionDate})` : ""}</dd>
              </dl>
              <p className={r.why}>Tasks for the bid (bid or no bid, partners, drafting, review, submission) are in <Link href="/tasks">Tasks</Link>, planned back from the deadline.</p>
            </section>
          )}

          <section className={r.panel}>
            <p className={r.panelTitle}>Proposal draft</p>
            {!proposal ? <p className={r.empty}>No draft yet. Claude writes first-pass sections from the call text and your bid library. Nothing is ever submitted for you.</p> : (
              <>
                <p className={ui.sub} style={{ marginTop: 0 }}>Drafted {proposal.draftedAt.slice(0, 16).replace("T", " ")} UTC. Edit before use. [TO CONFIRM] marks gaps.</p>
                {proposal.styleFlags.length > 0 && <p className={ui.notice}>House style: {proposal.styleFlags.join(" ")}</p>}
                {proposal.sections.map(s => <div key={s.heading} style={{ marginBottom: 12 }}><b>{s.heading}</b><p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, margin: "4px 0 0" }}>{s.body}</p></div>)}
                {proposal.gaps.length > 0 && <><b>To confirm</b><ul style={{ fontSize: 13, paddingLeft: 18 }}>{proposal.gaps.map(g => <li key={g}>{g}</li>)}</ul></>}
              </>
            )}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Possible applicants in the CRM</p>
            {matches.length === 0 ? <p className={r.empty}>Use Find applicants to list organizations in your CRM that look eligible (country, applicant type, sector).</p> : (
              <table className={ui.table}><tbody>{matches.map(m => (
                <tr key={m.m.id}>
                  <td><Link className={ui.primary} href={`/companies/${m.m.orgId}`}>{m.orgName}</Link><span className={ui.sub}>{m.m.reason}</span></td>
                  <td>{m.m.status === "contacted" ? <span className={ui.chip}>draft queued</span> : m.contactId
                    ? <form action={offerSupportAction}><input type="hidden" name="matchId" value={m.m.id} /><button className={ui.miniBtn} type="submit">Offer application support</button></form>
                    : <span className={ui.sub}>No contact with email</span>}</td>
                </tr>
              ))}</tbody></table>
            )}
          </section>

          {o.description && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Call text</p>
              <p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>{o.description}</p>
            </section>
          )}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>At a glance</p>
            <dl className={r.kv}>
              <dt>Route</dt><dd>{o.route ? ROUTE_LABEL[o.route] : "Not read yet"}</dd>
              <dt>Fit</dt><dd>{o.fit ?? "—"}{o.readAt ? "" : " (keywords)"}</dd>
              <dt>Amount</dt><dd>{amount(o.amountMin, o.amountMax, o.currency)}</dd>
              {o.cofinancingPct !== null && <><dt>Co-financing</dt><dd>{o.cofinancingPct}%</dd></>}
              <dt>Deadline</dt><dd style={{ color: d !== null && d <= 14 ? "#b0432f" : undefined }}>{o.deadline ?? "Not stated"}{d !== null ? ` (${daysLabel(d)})` : ""}</dd>
              {o.openDate && <><dt>Opens</dt><dd>{o.openDate}</dd></>}
              <dt>Programme</dt><dd>{o.programme ?? "—"}</dd>
              <dt>Countries</dt><dd>{(o.countries ?? []).join(", ") || "Not stated"}</dd>
              <dt>Applicants</dt><dd>{(o.applicantTypes ?? []).join(", ") || "Not stated"}</dd>
              <dt>Sectors</dt><dd>{(o.sectors ?? []).map(s => SECTORS[s as keyof typeof SECTORS] ?? s).join(", ") || "—"}</dd>
              <dt>Consortium</dt><dd>{o.read?.consortium ? "Needed" : o.read ? "Not required" : "—"}</dd>
              <dt>Source</dt><dd>{SOURCE_LABEL[o.source]}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

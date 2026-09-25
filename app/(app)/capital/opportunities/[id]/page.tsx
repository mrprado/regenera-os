import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalMatches, capitalOpportunities, capitalProfiles, commitments, contacts, materialDeliveries, organizations, privateCapitalProfiles, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { formation } from "@/lib/capital/engine";
import { COMMITMENT_STAGES, ELIGIBILITY, GATE_STATES, MATCH_STATUSES } from "@/lib/capital/vocab";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import { INSTRUMENTS } from "@/lib/projects/vocab";
import { addMaterialAction, matchStatusAction, runMatchesAction, setCommitmentAction, setGateAction, updateOpportunityAction } from "../../../capital-actions";
import styles from "../../../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital opportunity" };

export default async function CapitalOpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/capital");
  const { id } = await params;
  const sp = await searchParams;
  const db = appDb();
  const [row] = await db.select({ o: capitalOpportunities, projectName: projects.name }).from(capitalOpportunities).innerJoin(projects, eq(projects.id, capitalOpportunities.projectId))
    .where(and(eq(capitalOpportunities.id, id), mandateCondition(user.scope, capitalOpportunities.mandateId)));
  if (!row) notFound();
  const { o } = row;
  const owner = isOwner(user.scope);
  const [matches, ledger, deliveries, f, orgs] = await Promise.all([
    db.select().from(capitalMatches).where(eq(capitalMatches.opportunityId, id)).orderBy(desc(capitalMatches.commercialScore)),
    db.select().from(commitments).where(eq(commitments.opportunityId, id)),
    db.select().from(materialDeliveries).where(eq(materialDeliveries.opportunityId, id)).orderBy(desc(materialDeliveries.sentAt)).limit(50),
    formation(db, id),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000),
  ]);
  // Names for investor keys. Private investor names show to owners only.
  const profileIds = matches.map(m => m.capitalProfileId).concat(ledger.map(l => l.capitalProfileId)).filter(Boolean) as string[];
  const privateIds = matches.map(m => m.privateProfileId).concat(ledger.map(l => l.privateProfileId)).filter(Boolean) as string[];
  const profileNames = new Map((profileIds.length ? await db.select({ id: capitalProfiles.id, name: capitalProfiles.name }).from(capitalProfiles).where(inArray(capitalProfiles.id, profileIds.slice(0, 90))) : []).map(p => [`profile:${p.id}`, p.name]));
  const privateNames = new Map((privateIds.length ? await db.select({ id: privateCapitalProfiles.id, name: contacts.fullName }).from(privateCapitalProfiles).innerJoin(contacts, eq(contacts.id, privateCapitalProfiles.contactId)).where(inArray(privateCapitalProfiles.id, privateIds.slice(0, 90))) : []).map(p => [`private:${p.id}`, p.name]));
  const nameOf = (key: string) => profileNames.get(key) ?? (owner ? privateNames.get(key) : key.startsWith("private:") ? "Private investor (owner only)" : undefined) ?? key;
  const linkOf = (key: string) => key.startsWith("profile:") ? `/capital/partners/${key.slice(8)}` : owner && key.startsWith("private:") ? `/capital/private/${key.slice(8)}` : null;
  const pct = (n: number) => (f.target ? Math.min(100, Math.round((n / f.target) * 100)) : 0);

  return (
    <>
      <PageHeader title={o.title} actions={<Link className="btn" href={`/projects/${o.projectId}?tab=capital`}>Project: {row.projectName}</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -6 }}>{INSTRUMENTS[o.instrument as keyof typeof INSTRUMENTS] ?? o.instrument} · target {compactMoney(o.target, o.currency)} · <span className={o.gateState === "approved" ? ui.chip : ui.chipMuted}>Gate: {GATE_STATES[o.gateState]}</span></p>

      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>Capital formation</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Each investor counts once, at their current stage.</p>
            <table className={ui.table}><tbody>
              <tr><td>Target</td><td className={ui.num}>{compactMoney(f.target, f.currency)}</td><td /></tr>
              <tr><td>Identified (commercial fit ≥ 40)</td><td className={ui.num}>{f.identified}</td><td /></tr>
              <tr><td>Shortlisted or approved</td><td className={ui.num}>{f.matched}</td><td /></tr>
              <tr><td>Approved for outreach</td><td className={ui.num}>{f.outreachApproved}</td><td /></tr>
              {([["Interested", f.interested], ["IOI", f.ioi], ["Committed", f.committed], ["Funded", f.funded]] as const).map(([label, v]) => (
                <tr key={label}><td>{label}</td><td className={ui.num}>{v.investors} · {compactMoney(v.amount, f.currency)}</td><td style={{ width: 140 }}><div className={styles.bar}><i style={{ width: `${pct(v.amount)}%` }} /></div></td></tr>
              ))}
            </tbody></table>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}><span>Matches</span>
              <form action={runMatchesAction}><input type="hidden" name="id" value={o.id} /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Run matching</button></form></p>
            {matches.length === 0 ? <p className={r.empty}>No matches yet. Matching compares geography, sector, stage, instrument and ticket with each partner&apos;s profile and mandates, and each private investor&apos;s stated interests.</p> : (
              <table className={ui.table}>
                <thead><tr><th>Investor</th><th>Commercial alignment</th><th>Regulatory eligibility</th><th>Status</th></tr></thead>
                <tbody>{matches.map(m => {
                  const href = linkOf(m.investorKey);
                  return (
                    <tr key={m.id}>
                      <td>{href ? <Link href={href}>{nameOf(m.investorKey)}</Link> : nameOf(m.investorKey)}<span className={ui.sub}>{m.investorKey.startsWith("private:") ? "Private investor" : "Capital partner"}</span></td>
                      <td><b>{m.commercialScore}</b><span className={ui.sub}>{m.commercialReasons.join(" · ")}</span></td>
                      <td><span style={{ color: m.eligibility === "not_eligible" ? "#b0432f" : undefined }}>{ELIGIBILITY[m.eligibility]}</span><span className={ui.sub}>{m.eligibilityReasons.slice(0, 3).join(" · ")}</span></td>
                      <td>
                        <form action={matchStatusAction} className={styles.inline}>
                          <input type="hidden" name="matchId" value={m.id} />
                          <select name="status" defaultValue={m.status} aria-label="Match status">{Object.entries(MATCH_STATUSES).map(([k, v]) => <option key={k} value={k} disabled={k === "approved_for_outreach" && o.gateState !== "approved"}>{v}</option>)}</select>
                          <button className={ui.miniBtn} type="submit">Set</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Commitment ledger</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Conversation → interest → IOI → soft circle → commitment → executed subscription → funded. Commitment and later stages need evidence.</p>
            {ledger.length > 0 && (
              <table className={ui.table}><tbody>{ledger.map(l => (
                <tr key={l.id}><td>{nameOf(l.investorKey)}</td><td>{COMMITMENT_STAGES[l.stage]}</td><td className={ui.num}>{compactMoney(l.amount, l.currency)}</td><td className={ui.sub}>{l.evidence}</td></tr>
              ))}</tbody></table>
            )}
            {matches.length > 0 && (
              <form action={setCommitmentAction} className={styles.inline} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={o.id} />
                <select name="investorKey" required aria-label="Investor">{matches.map(m => <option key={m.investorKey} value={m.investorKey}>{nameOf(m.investorKey)}</option>)}</select>
                <select name="stage" aria-label="Stage">{Object.entries(COMMITMENT_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="amount" inputMode="decimal" placeholder="Amount" aria-label="Amount" style={{ width: 110 }} />
                <input name="evidence" placeholder="Evidence (e.g. signed IOI 2026-10-02)" aria-label="Evidence" style={{ minWidth: 200 }} />
                <button className={ui.miniBtn} type="submit">Update ledger</button>
              </form>
            )}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Material deliveries</p>
            {deliveries.length === 0 ? <p className={r.empty}>Nothing sent yet. Every gated email records which approved material versions the investor received.</p> : (
              <table className={ui.table}><tbody>{deliveries.map(d => (
                <tr key={d.id}><td>{nameOf(d.investorKey)}</td><td>{d.document} v{d.version}</td><td>{d.channel}</td><td className={ui.sub}>{d.sentAt.slice(0, 16).replace("T", " ")} · {d.sentBy}</td></tr>
              ))}</tbody></table>
            )}
          </section>
        </div>

        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Compliance gate</p>
            <dl className={r.kv}>
              <dt>State</dt><dd>{GATE_STATES[o.gateState]}</dd>
              <dt>Reviewer</dt><dd>{o.gateReviewer ?? "—"}{o.gateReviewedAt ? ` · ${o.gateReviewedAt.slice(0, 10)}` : ""}</dd>
              {o.gateEvidence && <><dt>Evidence</dt><dd>{o.gateEvidence}</dd></>}
              {o.gateConditions && <><dt>Conditions</dt><dd>{o.gateConditions}</dd></>}
            </dl>
            <p className={ui.sub}>The OS records who concluded what, on what evidence. It never states that an offering is compliant. Changing jurisdictions, the offering or materials returns the gate to Review required.</p>
            {owner ? (
              <form action={setGateAction} className={styles.stack}>
                <input type="hidden" name="id" value={o.id} />
                <select name="state" defaultValue={o.gateState} aria-label="Gate state">{Object.entries(GATE_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="reviewer" placeholder="Reviewer (name and role, e.g. counsel)" aria-label="Reviewer" />
                <textarea name="evidence" rows={2} placeholder="Evidence (memo, exemption relied on, date)" aria-label="Evidence" />
                <textarea name="conditions" rows={2} placeholder="Conditions (e.g. only verified accredited investors in the US)" aria-label="Conditions" />
                <button className="btn" type="submit">Record gate</button>
              </form>
            ) : <p className={ui.sub}>Only entity owners record gate reviews.</p>}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Approved materials</p>
            {o.approvedMaterials.length === 0 ? <p className={r.empty}>None. Investment communications cannot go out without approved materials.</p> : (
              <ul className={r.timeline}>{o.approvedMaterials.map(m => <li key={m.title}><span className={r.when}>v{m.version}</span><span>{m.ref ? <a href={m.ref} target="_blank" rel="noreferrer">{m.title}</a> : m.title}</span></li>)}</ul>
            )}
            <form action={addMaterialAction} className={styles.stack} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={o.id} />
              <input name="title" required placeholder="Document (e.g. Teaser)" aria-label="Document" />
              <input name="version" required placeholder="Version (e.g. 2026-10-01 v3)" aria-label="Version" />
              <input name="ref" placeholder="Link (Drive, data room)" aria-label="Link" />
              <button className={ui.miniBtn} type="submit">Add or replace version</button>
            </form>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Offering and roles</p>
            <form action={updateOpportunityAction} className={styles.stack}>
              <input type="hidden" name="id" value={o.id} />
              <label>Title<input name="title" defaultValue={o.title} /></label>
              <label>Offering<textarea name="offering" rows={3} defaultValue={o.offering} /></label>
              <label>Offering jurisdictions (ISO codes, comma-separated)<input name="jurisdictions" defaultValue={o.jurisdictions.join(", ")} placeholder="US, GB, MX" /></label>
              <label>Issuer<select name="issuerOrgId" defaultValue={o.issuerOrgId ?? ""}><option value="">Not set</option>{orgs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label>Sponsor<select name="sponsorOrgId" defaultValue={o.sponsorOrgId ?? ""}><option value="">Not set</option>{orgs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label>Arranger<input name="arranger" defaultValue={o.arranger} /></label>
              <label>Placement / distribution party<input name="placementParty" defaultValue={o.placementParty} /></label>
              <label>Counsel<input name="counsel" defaultValue={o.counsel} /></label>
              <label>Financial advisor<input name="financialAdvisor" defaultValue={o.financialAdvisor} /></label>
              <label>Regenera role<input name="regeneraRole" defaultValue={o.regeneraRole} /></label>
              <label>Status<select name="status" defaultValue={o.status}><option value="draft">Draft</option><option value="active">Active</option><option value="closed">Closed</option></select></label>
              <button className="btn" type="submit">Save</button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}

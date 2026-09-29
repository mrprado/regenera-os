import Link from "next/link";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { communityAttention, communityPortfolio } from "@/lib/community/engine";
import { COMMUNITY_TYPES, CONSENT_STATUS, LEDGERS, LEGAL_NOTE, PARTICIPATION_TYPES } from "@/lib/community/vocab";
import s from "../projects/natural.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Community & knowledge governance" };

export default async function CommunityPage() {
  const user = await requireOsUser("/community");
  const db = appDb();
  const today = new Date().toISOString().slice(0, 10);
  const [p, attention] = await Promise.all([communityPortfolio(db, user.scope.mandateIds), communityAttention(db, user.scope.mandateIds, today)]);
  if (!p) return <PageHeader title="Community & knowledge governance" />;
  const pname = new Map(p.projects.map(x => [x.id, x.name]));
  const money = (n: number) => `USD ${Math.round(n).toLocaleString("en-US")}`;
  return (
    <>
      <PageHeader title="Community & knowledge governance" />
      <p className={ui.sub}>Community rights, knowledge governance and community economic participation across the portfolio. Work happens on each project&apos;s Community / rights tab. Figures stay in their own ledger; nothing is combined into a single community-contribution number or score.</p>
      <div className={s.strip}>
        {[["Communities", p.communities.length], ["Rights requiring action", p.rightsOpen], ["Consent granted", (p.consentByStatus.granted ?? 0) + (p.consentByStatus.granted_with_conditions ?? 0)], ["Consent in progress", Object.entries(p.consentByStatus).filter(([k]) => !["granted", "granted_with_conditions", "not_applicable"].includes(k)).reduce((a, [, v]) => a + v, 0)], ["Active participation structures", p.activeStructures], ["Outstanding commitments", p.commitmentsOutstanding], ["Overdue commitments", p.commitmentsOverdue], ["Open grievances", p.grievancesOpen], ["Governed knowledge records", p.restrictedKnowledge]].map(([k, v]) => <div key={String(k)}><span>{k}</span><b>{v}</b></div>)}
      </div>
      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}>Needs attention</p>
          {attention.length === 0 ? <p className={r.empty}>Nothing overdue, expiring or unresolved.</p> : <table className={ui.table}><tbody>{attention.map(a => <tr key={a.key}><td><span className={ui.chip}>{a.severity}</span></td><td>{a.entity}</td><td><Link href={a.href}>{a.issue}</Link></td><td>{a.due ?? ""}</td></tr>)}</tbody></table>}
          <p className={r.panelTitle} style={{ marginTop: 14 }}>Communities</p>
          {p.communities.length === 0 ? <p className={r.empty}>No communities recorded. Add them from a project&apos;s Community / rights tab.</p> : <table className={ui.table}><thead><tr><th>Community</th><th>Type</th><th>Project</th><th>Representation</th><th>Authority</th></tr></thead><tbody>
            {p.communities.map(c => <tr key={c.id}><td className={ui.primary}>{c.projectId ? <Link href={`/projects/${c.projectId}?tab=community`}>{c.name}</Link> : c.name}{c.isDemo ? <span className={ui.chip}> DEMO</span> : null}</td><td>{COMMUNITY_TYPES[c.communityType]}</td><td>{c.projectId ? pname.get(c.projectId) : "—"}</td><td>{c.representationVerified ? "Verified" : "Not verified"}</td><td>{c.authorityVerified ? "Verified" : "Not verified"}</td></tr>)}
          </tbody></table>}
          <p className={r.panelTitle} style={{ marginTop: 14 }}>Participation structures</p>
          {p.structures.length === 0 ? <p className={r.empty}>None yet.</p> : <table className={ui.table}><thead><tr><th>Project</th><th>Scenario</th><th>Structure</th><th>Type</th><th>Status</th></tr></thead><tbody>
            {p.structures.map(x => <tr key={x.id}><td><Link href={`/projects/${x.projectId}?tab=community&sec=participation`}>{pname.get(x.projectId) ?? "—"}</Link></td><td>{x.scenario}</td><td>{x.name}</td><td>{PARTICIPATION_TYPES[x.type]}</td><td>{x.status}</td></tr>)}
          </tbody></table>}
        </section>
        <aside>
          <section className={r.panel}><p className={r.panelTitle}>Ledgers (paid to date)</p>
            {(Object.keys(LEDGERS) as (keyof typeof LEDGERS)[]).map(k => <p key={k}><b>{LEDGERS[k].label}</b><br /><span className={ui.sub}>paid {money(p.ledger[k].paid)} · scheduled {money(p.ledger[k].scheduled)}{p.ledger[k].overdue ? ` · overdue ${money(p.ledger[k].overdue)}` : ""}</span></p>)}
            {p.misclassified > 0 && <p className={ui.warn}>{p.misclassified} ledger entr{p.misclassified === 1 ? "y" : "ies"} look like compensation recorded outside Ledger A.</p>}
            <p className={ui.sub}>Amounts are nominal and in the currency entered; mixed currencies are not converted.</p>
          </section>
          <section className={r.panel}><p className={r.panelTitle}>Consent by status</p>
            {Object.keys(p.consentByStatus).length === 0 ? <p className={r.empty}>No consent records.</p> : Object.entries(p.consentByStatus).map(([k, v]) => <p key={k} className={ui.sub}>{CONSENT_STATUS[k as keyof typeof CONSENT_STATUS]}: {v}</p>)}
          </section>
          <section className={r.panel}><p className={r.panelTitle}>Integrations</p>
            <p className={ui.sub}>Local Contexts (TK / BC notices and labels): NOT CONNECTED. Fields are ready on communities and knowledge records; labels are never recreated as Regenera classifications.</p>
          </section>
        </aside>
      </div>
      <p className={ui.sub}>{LEGAL_NOTE}</p>
    </>
  );
}

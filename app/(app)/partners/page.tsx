import Link from "next/link";
import { Handshake } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { siteConfig } from "@/lib/config";
import { partnerOverview, TIER_FEE } from "@/lib/crm/partners";
import { DEAL_STAGES } from "@/lib/vocab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partners" };

const TIER_CHIP: Record<string, string> = { standard: "", strategic: ui.chipPollen, institutional: ui.chipReed };
const money = (n: number) => (n ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—");

export default async function PartnersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/partners");
  const sp = await searchParams;
  const tab = sp.tab === "candidates" ? "candidates" : "network";
  const { partners, byTier, candidates, unlinked } = await partnerOverview(user.scope);
  return (
    <>
      <PageHeader title="Partners" count={partners.length} actions={<a className="btn" href="https://regenera.bio/partners" target="_blank" rel="noreferrer">regenera.bio/partners</a>} />
      {!siteConfig() && <p className={ui.notice}>Partner accounts and referrals sync from regenera.bio every hour once <code>SITE_EXPORT_TOKEN</code> is set and the site&apos;s os-integration branch is published. Referrals already arrive by webhook.</p>}
      <div className={ui.stats}>
        {byTier.map(t => (
          <div key={t.tier} className={ui.stat}>
            <b>{t.partners}</b>
            <span>{t.tier[0].toUpperCase() + t.tier.slice(1)} ({Math.round(TIER_FEE[t.tier] * 100)}%) · {t.referrals} referrals · {t.won} won · fee owed {money(t.feeOwed)}</span>
          </div>
        ))}
      </div>
      <nav className={ui.tabs} aria-label="Partner views">
        <Link className={`${ui.tab} ${tab === "network" ? ui.tabActive : ""}`} href="/partners">Partner Network<span className={ui.tabCount}>{partners.length}</span></Link>
        <Link className={`${ui.tab} ${tab === "candidates" ? ui.tabActive : ""}`} href="/partners?tab=candidates">Candidates to invite<span className={ui.tabCount}>{candidates.length}</span></Link>
      </nav>
      {tab === "network" ? (
        partners.length === 0 ? (
          <EmptyState icon={Handshake} title="No partners yet" body="Partners appear here when they register or refer someone at regenera.bio/partners, or when a partnership inquiry arrives." />
        ) : (
          <>
            {unlinked > 0 && <p className={ui.sub} style={{ marginTop: 0 }}>{unlinked} referral deals from before the partner link existed are counted in Reports but not per partner.</p>}
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th>Partner</th><th>Tier</th><th className={ui.num}>Referrals</th><th className={ui.num}>Open</th><th className={ui.num}>Won</th><th className={ui.num}>Lost</th><th className={ui.num}>Fee owed</th><th>Latest referrals</th></tr></thead>
                <tbody>
                  {partners.map(p => (
                    <tr key={p.id}>
                      <td><span className={ui.primary}>{p.name}</span><span className={ui.sub}>{[p.organization ?? p.orgName, p.email].filter(Boolean).join(" · ")}</span></td>
                      <td><span className={`${ui.chip} ${TIER_CHIP[p.tier] ?? ""}`}>{p.tier}</span>{p.status !== "active" && <span className={ui.sub}>{p.status}</span>}</td>
                      <td className={ui.num}>{p.referrals}</td>
                      <td className={ui.num}>{p.open}</td>
                      <td className={ui.num}>{p.won}</td>
                      <td className={ui.num}>{p.lost}</td>
                      <td className={ui.num}>{money(p.feeOwed)}</td>
                      <td className={ui.wrap}>{p.deals.length ? p.deals.map(d => <span key={d.id} className={ui.sub} style={{ marginTop: 0 }}><Link href={`/deals?focus=${d.id}`}>{d.name}</Link> · {DEAL_STAGES[d.stage as keyof typeof DEAL_STAGES]}</span>) : <span className={ui.chipMuted}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        candidates.length === 0 ? (
          <EmptyState icon={Handshake} title="No candidates yet" body="Organizations in the channel segments (EPC and engineering firms, ESG law, Big 4, architects and planners, banks and lenders) show here as Partner Network candidates. Find them from Searches or Companies." />
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Organization</th><th>Segment</th><th>Country</th></tr></thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={c.id}><td><Link className={ui.primary} href={`/companies/${c.id}`}>{c.name}</Link></td><td>{c.segment}</td><td>{c.country ?? "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}

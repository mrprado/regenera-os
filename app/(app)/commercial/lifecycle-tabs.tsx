import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { deals, deliveryTemplates, offerProposals, offerProposalVersions, organizations, services } from "@/db/schema";
import { appDb, isOwner, type Scope } from "@/lib/db/scoped";
import { ownerEconomics } from "@/lib/lifecycle/economics";
import { versionTotal } from "@/lib/lifecycle/proposals";
import { PROPOSAL_STATUS, SERVICE_OFFER_STATUS, TEMPLATE_STATUS } from "@/lib/lifecycle/vocab";
import { ensureTemplatesAction, setServiceOfferAction, setTemplateStatusAction } from "../lifecycle-actions";

const money = (n: number | null, c: string) => (n == null ? "—" : `${c} ${Math.round(n).toLocaleString("en-US")}`);

/** Regenera's own money by stage and currency (phase 29A). No weighting, no conversion, no project capital. */
export async function OwnerEconomics({ scope }: { scope: Scope & { mandateIds: string[] } }) {
  const { lines, definitions } = await ownerEconomics(appDb(), scope.mandateIds);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Regenera fees by stage</p>
      {lines.length === 0 ? <p className={r.empty}>No proposals sent or engagements signed yet.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Currency</th>{(["proposed", "contracted", "invoiced", "collected", "outstanding", "deliveryCost", "margin", "recurringMonthly"] as const).map(k => <th key={k} className={ui.num} title={definitions[k]}>{{ proposed: "Proposed", contracted: "Contracted", invoiced: "Invoiced", collected: "Collected", outstanding: "Outstanding", deliveryCost: "Delivery cost", margin: "Margin", recurringMonthly: "Recurring / month" }[k]}</th>)}</tr></thead>
          <tbody>{lines.map(l => <tr key={l.currency}><td>{l.currency}</td><td className={ui.num}>{money(l.proposed, l.currency)}{l.proposedUnpriced ? <span className={ui.sub}>+{l.proposedUnpriced} unpriced</span> : null}</td><td className={ui.num}>{money(l.contracted, l.currency)}</td><td className={ui.num}>{money(l.invoiced, l.currency)}</td><td className={ui.num}>{money(l.collected, l.currency)}</td><td className={ui.num}>{money(l.outstanding, l.currency)}{l.overdue ? <span className={ui.sub}>{money(l.overdue, l.currency)} overdue</span> : null}</td><td className={ui.num}>{money(l.deliveryCost, l.currency)}</td><td className={ui.num}>{l.margin == null ? <span className={ui.sub}>{l.costStatus === "rate_missing" ? "needs internal rate" : "no costs recorded"}</span> : money(l.margin, l.currency)}</td><td className={ui.num}>{money(l.recurringMonthly, l.currency)}</td></tr>)}</tbody>
        </table></div>
      )}
      <p className={ui.sub}>Each currency is reported on its own; nothing is converted or weighted by probability. Project capital requirements and investor commitments are never included. Hover a heading for its definition.</p>
    </section>
  );
}

export async function ProposalsTab({ scope }: { scope: Scope & { mandateIds: string[] } }) {
  const db = appDb();
  const ps = scope.mandateIds.length ? await db.select().from(offerProposals).where(inArray(offerProposals.mandateId, scope.mandateIds)).orderBy(desc(offerProposals.updatedAt)).limit(200) : [];
  const [vs, ds, os] = ps.length ? await Promise.all([
    db.select().from(offerProposalVersions).where(inArray(offerProposalVersions.proposalId, ps.map(p => p.id))),
    db.select({ id: deals.id, name: deals.name }).from(deals).where(inArray(deals.id, ps.map(p => p.dealId))),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, ps.map(p => p.orgId).filter((x): x is string => !!x).concat("-"))),
  ]) : [[], [], []];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Proposals</p>
      <p className={ui.sub}>Draft a proposal from an opportunity (Sales pipeline → opportunity → Proposals). Sent versions are frozen; the accepted version is the agreed scope.</p>
      {ps.length === 0 ? <p className={r.empty}>No proposals yet.</p> : (
        <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Proposal</th><th>Client</th><th>Status</th><th>Version</th><th className={ui.num}>Fee</th><th>Valid until</th></tr></thead><tbody>
          {ps.map(p => { const v = vs.filter(x => x.proposalId === p.id).sort((a, b) => b.version - a.version)[0]; const live = vs.find(x => x.proposalId === p.id && (x.id === p.acceptedVersionId || x.status === "sent")) ?? v; return (
            <tr key={p.id}><td><Link href={`/commercial/proposals/${p.id}`}>{p.title}</Link><span className={ui.sub}>{ds.find(d => d.id === p.dealId)?.name}</span></td><td>{os.find(o => o.id === p.orgId)?.name ?? "—"}</td><td>{PROPOSAL_STATUS[p.status]}</td><td>v{p.currentVersion}</td><td className={ui.num}>{live ? money(versionTotal(live), live.currency) : "—"}</td><td style={{ color: live?.validUntil && live.validUntil < today && p.status === "sent" ? "var(--critical)" : undefined }}>{live?.validUntil ?? "—"}</td></tr>); })}
        </tbody></table></div>
      )}
    </section>
  );
}

export async function TemplatesTab({ scope }: { scope: Scope & { mandateIds: string[] } }) {
  const ts = scope.mandateIds.length ? await appDb().select().from(deliveryTemplates).where(inArray(deliveryTemplates.mandateId, scope.mandateIds)) : [];
  const owner = scope.mandateIds.some(m => isOwner(scope, m));
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Delivery templates</p>
      <p className={ui.sub}>A template sets the milestones, deliverables, client requests and tasks an engagement starts with. Editing makes a new version; engagements keep the version they started from. Starter templates are drafts for you to review.</p>
      {ts.length === 0 && <form action={ensureTemplatesAction}><button className="btn" type="submit">Add the six starter templates (drafts)</button></form>}
      {ts.length > 0 && <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Template</th><th>Version</th><th>Status</th><th>Milestones</th><th>Deliverables</th><th>Client requests</th><th /></tr></thead><tbody>
        {ts.sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version).map(t => <tr key={t.id}><td>{t.name}<span className={ui.sub}>{t.description}</span></td><td>v{t.version}</td><td>{TEMPLATE_STATUS[t.status]}</td><td>{t.milestones.map(m => m.label).join(" → ")}</td><td>{t.deliverables.length}</td><td>{t.requests.length}</td>
          <td>{owner && t.status !== "approved" && t.status !== "retired" && <form action={setTemplateStatusAction}><input type="hidden" name="templateId" value={t.id} /><input type="hidden" name="status" value="approved" /><button className={ui.miniBtn} type="submit">Approve</button></form>}
            {owner && t.status !== "retired" && <form action={setTemplateStatusAction}><input type="hidden" name="templateId" value={t.id} /><input type="hidden" name="status" value="retired" /><button className={ui.miniBtn} type="submit">Retire</button></form>}</td></tr>)}
      </tbody></table></div>}
    </section>
  );
}

/** Offer status cell on the services table: draft offers cannot go out on a sent proposal. */
export function OfferStatus({ s, owner }: { s: typeof services.$inferSelect; owner: boolean }) {
  const btn = (status: string, label: string) => <form action={setServiceOfferAction}><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="status" value={status} /><button className={ui.miniBtn} type="submit">{label}</button></form>;
  return (
    <>
      <span className={s.offerStatus === "approved" ? ui.chipReed : ui.chipMuted}>{SERVICE_OFFER_STATUS[s.offerStatus]}</span>
      {s.approvedBy && s.offerStatus === "approved" && <span className={ui.sub}>by {s.approvedBy} · v{s.offerVersion}</span>}
      {owner && s.offerStatus !== "approved" && btn("approved", "Approve offer")}
      {owner && s.offerStatus === "approved" && btn("draft", "Back to draft")}
    </>
  );
}

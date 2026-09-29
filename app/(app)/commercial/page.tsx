import Link from "next/link";
import { asc, eq, isNull, and } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { accountConnections, commercialPartners, corporateEntities, organizations, projects, services } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { commercialOverview, ensureServices, priceService } from "@/lib/commercial/engine";
import { ACCOUNT_CATEGORIES, ACCOUNT_STATUSES, BILLING_TYPES, DEPTHS, ENGAGEMENT_STATUSES, ENTITY_KINDS, INVOICE_STATUSES, LIFECYCLE_PHASES, PARTNER_KINDS, SERVICE_FAMILIES, VENDOR_CAPABILITIES } from "@/lib/commercial/vocab";
import { addAccountAction, addEntityAction, addPartnerAction, createEngagementAction, updateServiceAction } from "../commercial-actions";
import styles from "./commercial.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commercial" };

const TABS = [["overview", "Overview"], ["engagements", "Engagements"], ["services", "Services & pricing"], ["billing", "Billing"], ["partners", "Partners & vendors"], ["accounts", "Accounts"], ["entities", "Entities"]] as const;
const money = (n: number | null | undefined, cur = "USD") => (n === null || n === undefined ? "—" : `${cur} ${Math.round(n).toLocaleString("en-US")}`);

export default async function CommercialPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/commercial");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const db = appDb();
  // The catalogue is the firm's own (primary entity); other entities keep theirs but are not listed twice here.
  const primary = user.scope.mandateIds.find(m => m !== "mandate_demo") ?? user.scope.mandateIds[0];
  await ensureServices(db, primary);
  const [o, svc] = await Promise.all([commercialOverview(db, user.scope.mandateIds), db.select().from(services).where(and(mandateCondition(user.scope, services.mandateId), eq(services.mandateId, primary))).orderBy(asc(services.phase), asc(services.name))]);
  const svcName = new Map(svc.map(s => [s.key, `${s.name}${s.depth !== "standard" ? ` · ${DEPTHS[s.depth]}` : ""}`]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Commercial" />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Commercial sections">{TABS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/commercial${k === "overview" ? "" : `?tab=${k}`}`}>{l}</Link>)}</nav>

      {tab === "overview" && o && <>
        <div className={styles.strip}>
          {[["Pipeline", money(o.pipelineValue)], ["Weighted pipeline", money(o.pipelineWeighted)], ["Active contract value", money(o.activeValue)], ["MRR / ARR", `${money(o.mrr)} / ${money(o.arr)}`], ["Receivables", money(o.receivables)], ["Overdue invoices", String(o.overdue.length)], ["Win rate", o.winRate === null ? "—" : `${o.winRate}%`]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
        <p className={ui.sub}>Advisory economics of Regenera only: kept separate from project investment economics (project Financials). Pipeline weights are stage defaults unless set per engagement.</p>
        <div className={r.grid}>
          <section className={r.panel}><p className={r.panelTitle}>By service line</p>
            <table className={ui.table}><thead><tr><th>Service</th><th>Engagements</th><th>Contract value</th><th>Gross margin</th></tr></thead><tbody>{o.byService.map(s => <tr key={s.service}><td>{svcName.get(s.service) ?? s.service}</td><td className={ui.num}>{s.count}</td><td className={ui.num}>{money(s.contract)}</td><td className={ui.num}>{s.marginPct === null ? "—" : `${s.marginPct}%`}</td></tr>)}</tbody></table>
            <p className={ui.sub}>Margins exclude internal time where no cost rate is set on the engagement.</p>
          </section>
          <aside><section className={r.panel}><p className={r.panelTitle}>By client</p>
            <table className={ui.table}><tbody>{o.byClient.slice(0, 12).map(c => <tr key={c.client}><td>{c.client}</td><td className={ui.num}>{money(c.contract)}</td><td className={ui.num}>{money(c.collected)} collected</td></tr>)}</tbody></table>
          </section></aside>
        </div>
      </>}

      {tab === "engagements" && o && <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}>Engagements</p>
          {o.rows.length === 0 ? <p className={r.empty}>No engagements yet. Create one from services on the right.</p> : (
            <table className={ui.table}><thead><tr><th>Engagement</th><th>Client</th><th>Status</th><th>Services</th><th>Contract value</th><th>Weighted</th><th>Collected</th><th>Margin</th></tr></thead><tbody>
              {o.rows.map(x => <tr key={x.e.id}><td className={ui.primary}><Link href={`/commercial/engagements/${x.e.id}`}>{x.e.name}</Link></td><td>{x.client}</td><td><span className={ui.chip}>{ENGAGEMENT_STATUSES[x.e.status]}</span></td><td className={ui.sub}>{x.e.workstreams.map(k => svcName.get(k) ?? k).join(", ")}</td>
                <td className={ui.num}>{money(x.econ.contractValue, x.e.currency)}</td><td className={ui.num}>{money(x.econ.weighted, x.e.currency)} ({x.econ.probabilityPct}%)</td><td className={ui.num}>{money(x.econ.collected, x.e.currency)}</td><td className={ui.num}>{x.econ.marginPct === null ? "—" : `${x.econ.marginPct}%`}</td></tr>)}
            </tbody></table>)}
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>New engagement</p>
          <NewEngagement userMandates={user.scope.mandateIds} svc={svc} scope={user.scope} />
        </section></aside>
      </div>}

      {tab === "services" && <section className={r.panel}>
        <p className={r.panelTitle}>Service catalogue and pricing</p>
        <p className={ui.sub}>Price bands are Regenera&apos;s internal defaults, not market facts. Suggested price = list × complexity (× urgency), raised to meet the target margin on known costs; set an internal hourly cost on an engagement to include time. Changes are audited.</p>
        <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Service</th><th>Phase</th><th>Billing</th><th>Band</th><th>List</th><th>Minimum</th><th>Hours</th><th>External cost</th><th>Target margin</th><th>Suggested (std, $120/h)</th><th>Role · specialists</th><th /></tr></thead><tbody>
          {svc.map(s => { const p = priceService(s, { complexity: "standard", urgency: false, travelCost: 0, specialistCost: 0, hourlyCost: 120 }); return (
            <tr key={s.id} className={s.active ? undefined : styles.inactive}>
              <td className={ui.primary}>{s.name}{s.depth !== "standard" ? <span className={ui.chip}> {DEPTHS[s.depth]}</span> : null}<span className={ui.sub}>{SERVICE_FAMILIES[s.family]}{s.approvalRequired ? " · approval required" : ""}</span></td>
              <td className={ui.sub}>{LIFECYCLE_PHASES[s.phase]}</td><td className={ui.sub}>{BILLING_TYPES[s.billingType]}</td>
              <td className={ui.num}>{money(s.bandLow)}–{s.bandHigh ? money(s.bandHigh) : "+"}{s.perMonth ? "/mo" : ""}</td>
              <td colSpan={5}><form action={updateServiceAction} className={styles.priceForm}><input type="hidden" name="id" value={s.id} />
                <input name="listPrice" defaultValue={s.listPrice ?? ""} aria-label="List price" /><input name="minPrice" defaultValue={s.minPrice ?? ""} aria-label="Minimum" /><input name="expectedHours" defaultValue={s.expectedHours} aria-label="Hours" /><input name="expectedExternalCost" defaultValue={s.expectedExternalCost} aria-label="External cost" /><input name="targetMarginPct" defaultValue={s.targetMarginPct} aria-label="Target margin %" />
                <label className={ui.sub}><input type="checkbox" name="active" defaultChecked={s.active} /> active</label><button className={ui.miniBtn} type="submit">Save</button></form></td>
              <td className={ui.num}>{money(p.suggested)}{s.perMonth ? "/mo" : ""}<span className={ui.sub}>{p.expectedMarginPct === null ? "" : `${p.expectedMarginPct}% margin`}{p.lowMargin ? " · LOW MARGIN" : ""}</span></td>
              <td className={ui.sub}>{s.role.replace(/_/g, " ")}{s.specialistRequired.length ? ` · specialist: ${s.specialistRequired.join(", ")}` : ""}{s.legalNotes ? ` · ${s.legalNotes}` : ""}</td>
              <td />
            </tr>); })}
        </tbody></table></div>
      </section>}

      {tab === "billing" && o && <section className={r.panel}>
        <p className={r.panelTitle}>Invoices</p>
        <p className={ui.sub}>Status is derived from dates and payments: due within 7 days, overdue after the due date (escalated on Today at 7 and 30 days). The OS records invoices; sending and collection happen in your billing system (Stripe / accounting adapters are NOT CONNECTED).</p>
        {o.invoices.length === 0 ? <p className={r.empty}>No invoices yet. Draft them from an engagement&apos;s payment schedule.</p> : (
          <table className={ui.table}><thead><tr><th>Number</th><th>Engagement</th><th>Milestone</th><th>Amount</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead><tbody>
            {[...o.invoices].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")).map(i => <tr key={i.id}><td>{i.number}</td><td><Link href={`/commercial/engagements/${i.engagementId}`}>{o.rows.find(x => x.e.id === i.engagementId)?.e.name ?? "—"}</Link></td><td>{i.milestone}</td><td className={ui.num}>{money(i.amount, i.currency)}</td><td className={ui.num}>{money(i.paidAmount, i.currency)}</td><td style={{ color: i.derived === "overdue" ? "#b0432f" : undefined }}>{i.dueDate ?? "—"}</td><td><span className={ui.chip}>{INVOICE_STATUSES[i.derived as keyof typeof INVOICE_STATUSES]}</span></td></tr>)}
          </tbody></table>)}
        <p className={ui.sub}>Today {today}.</p>
      </section>}

      {tab === "partners" && <Partners scope={user.scope} />}
      {tab === "accounts" && <Accounts scope={user.scope} />}
      {tab === "entities" && <Entities scope={user.scope} />}
    </>
  );
}

async function NewEngagement({ svc, scope }: { userMandates: string[]; svc: (typeof services.$inferSelect)[]; scope: Parameters<typeof mandateCondition>[0] }) {
  const db = appDb();
  const [orgs, projs] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(800),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
  ]);
  return (
    <form action={createEngagementAction} className={r.form}>
      <label>Name<input name="name" required placeholder="e.g. Valle Solar pre-feasibility" /></label>
      <label>Client<select name="orgId" defaultValue=""><option value="">Select client</option>{orgs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Project<select name="projectId" defaultValue=""><option value="">None yet</option>{projs.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <fieldset className={styles.services}><legend>Services (workstreams)</legend>
        {svc.filter(s => s.active).map(s => <label key={s.id}><input type="checkbox" name="serviceId" value={s.id} /> {s.name}{s.depth !== "standard" ? ` · ${DEPTHS[s.depth]}` : ""} <small>{s.perMonth ? "monthly" : ""}</small></label>)}
      </fieldset>
      <label>Months (retainer services)<input name="months" inputMode="numeric" placeholder="6" /></label>
      <label>Source<select name="source" defaultValue="direct"><option value="referral">Referral</option><option value="linkedin">LinkedIn</option><option value="email">Email</option><option value="existing_client">Existing client</option><option value="partner">Partner</option><option value="event">Event</option><option value="website">Website</option><option value="inbound">Inbound</option><option value="direct">Direct origination</option></select></label>
      <button className="btn btn--primary" type="submit">Create engagement</button>
    </form>
  );
}

async function Partners({ scope }: { scope: Parameters<typeof mandateCondition>[0] }) {
  const rows = await appDb().select().from(commercialPartners).where(mandateCondition(scope, commercialPartners.mandateId)).orderBy(asc(commercialPartners.name));
  const today = new Date().toISOString().slice(0, 10);
  return <div className={r.grid}>
    <section className={r.panel}><p className={r.panelTitle}>Partners and vendors</p>
      {rows.length === 0 ? <p className={r.empty}>No partners or vendors recorded.</p> : <table className={ui.table}><thead><tr><th>Name</th><th>Kind</th><th>Capabilities</th><th>Geographies</th><th>Rates / terms</th><th>Insurance</th></tr></thead><tbody>
        {rows.map(p => <tr key={p.id}><td className={ui.primary}>{p.name}</td><td>{PARTNER_KINDS[p.kind]}</td><td className={ui.sub}>{p.capabilities.join(", ")}</td><td className={ui.sub}>{p.geographies.join(", ")}</td><td className={ui.sub}>{[p.rates, p.paymentTerms, p.commercialTerms].filter(Boolean).join(" · ")}</td><td style={{ color: p.insuranceExpiry && p.insuranceExpiry < today ? "#b0432f" : undefined }}>{p.insuranceExpiry ?? "—"}</td></tr>)}
      </tbody></table>}
      <p className={ui.sub}>Builders, EPCs and suppliers for projects live in <Link href="/network">Builders &amp; suppliers</Link>.</p>
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add partner / vendor</p>
      <form action={addPartnerAction} className={r.form}>
        <label>Name<input name="name" required /></label>
        <label>Kind<select name="kind" defaultValue="vendor">{Object.entries(PARTNER_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <fieldset className={styles.services}><legend>Capabilities</legend>{VENDOR_CAPABILITIES.map(c => <label key={c}><input type="checkbox" name="capability" value={c} /> {c}</label>)}</fieldset>
        <label>Geographies<input name="geographies" placeholder="MEX, BLZ, NZL" /></label>
        <label>Rates<input name="rates" /></label><label>Payment terms<input name="paymentTerms" /></label><label>Commercial terms<input name="commercialTerms" placeholder="e.g. 70/30 revenue share on joint delivery" /></label>
        <label>Insurance certificate expiry<input name="insuranceExpiry" type="date" /></label>
        <button className="btn" type="submit">Add</button>
      </form></section></aside>
  </div>;
}

async function Accounts({ scope }: { scope: Parameters<typeof mandateCondition>[0] }) {
  const rows = await appDb().select().from(accountConnections).where(mandateCondition(scope, accountConnections.mandateId)).orderBy(asc(accountConnections.category), asc(accountConnections.provider));
  const monthly = rows.reduce((a, x) => a + (x.monthlyCost ?? (x.annualCost ? x.annualCost / 12 : 0)), 0);
  return <div className={r.grid}>
    <section className={r.panel}><p className={r.panelTitle}><span>Account connections</span><span className={ui.sub}>software operating cost ≈ USD {Math.round(monthly).toLocaleString("en-US")}/month</span></p>
      <p className={ui.sub}>A registry of the firm&apos;s accounts: owner, entity, environment, contacts, plan, cost and renewal. No passwords or keys are stored here; API credentials are Worker secrets and connectors use OAuth. Data providers and their licences are in <Link href="/settings/integrations">Settings → Integrations</Link>.</p>
      {rows.length === 0 ? <p className={r.empty}>No accounts recorded.</p> : <table className={ui.table}><thead><tr><th>Provider</th><th>Category</th><th>Status</th><th>Owner / entity</th><th>Env.</th><th>Plan</th><th>Cost</th><th>Renewal</th><th>Allocation</th></tr></thead><tbody>
        {rows.map(a => <tr key={a.id}><td className={ui.primary}>{a.provider}<span className={ui.sub}>{a.purpose}</span></td><td>{ACCOUNT_CATEGORIES[a.category]}</td><td><span className={ui.chip}>{ACCOUNT_STATUSES[a.status]}</span></td><td className={ui.sub}>{[a.accountOwner, a.entity].filter(Boolean).join(" · ")}</td><td>{a.environment}</td><td>{a.plan}</td><td className={ui.num}>{a.monthlyCost ? `${a.currency} ${a.monthlyCost}/mo` : a.annualCost ? `${a.currency} ${a.annualCost}/yr` : "—"}</td><td>{a.renewalDate ?? "—"}</td><td>{a.costAllocation}</td></tr>)}
      </tbody></table>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Record an account</p>
      <form action={addAccountAction} className={r.form}>
        <label>Provider<input name="provider" required placeholder="e.g. Google Workspace, Stripe, QuickBooks, DocuSign" /></label>
        <label>Category<select name="category" defaultValue="communication">{Object.entries(ACCOUNT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Status<select name="status" defaultValue="disconnected">{Object.entries(ACCOUNT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Account owner<input name="accountOwner" /></label><label>Business entity<input name="entity" /></label>
        <label>Environment<select name="environment" defaultValue="production"><option value="production">Production</option><option value="sandbox">Sandbox</option></select></label>
        <label>Plan<input name="plan" /></label><label>Monthly cost<input name="monthlyCost" inputMode="decimal" /></label><label>Annual cost<input name="annualCost" inputMode="decimal" /></label>
        <label>Renewal<input name="renewalDate" type="date" /></label><label>Admin contact<input name="adminContact" /></label><label>Purpose<input name="purpose" /></label>
        <label>Cost allocation<select name="costAllocation" defaultValue="overhead"><option value="overhead">Corporate overhead</option><option value="project">Project</option><option value="engagement">Client engagement</option></select></label>
        <button className="btn" type="submit">Record</button>
      </form></section></aside>
  </div>;
}

async function Entities({ scope }: { scope: Parameters<typeof mandateCondition>[0] }) {
  const rows = await appDb().select().from(corporateEntities).where(mandateCondition(scope, corporateEntities.mandateId)).orderBy(asc(corporateEntities.name));
  const today = new Date().toISOString().slice(0, 10);
  return <div className={r.grid}>
    <section className={r.panel}><p className={r.panelTitle}>Corporate entities and SPVs</p>
      <p className={ui.sub}>Client funds are never merged with Regenera corporate accounts; engagements and projects can reference the relevant entity or SPV.</p>
      {rows.length === 0 ? <p className={r.empty}>No entities recorded.</p> : <table className={ui.table}><thead><tr><th>Entity</th><th>Kind</th><th>Jurisdiction</th><th>Formed</th><th>Ownership</th><th>Registered agent</th><th>Annual filing</th></tr></thead><tbody>
        {rows.map(x => <tr key={x.id}><td className={ui.primary}>{x.name}</td><td>{ENTITY_KINDS[x.kind]}</td><td>{x.jurisdiction}</td><td>{x.formationDate ?? "—"}</td><td className={ui.sub}>{x.ownership}</td><td>{x.registeredAgent}</td><td style={{ color: x.annualFilingDue && x.annualFilingDue < today ? "#b0432f" : undefined }}>{x.annualFilingDue ?? "—"}</td></tr>)}
      </tbody></table>}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add entity</p>
      <form action={addEntityAction} className={r.form}>
        <label>Name<input name="name" required /></label>
        <label>Kind<select name="kind" defaultValue="operating">{Object.entries(ENTITY_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Jurisdiction<input name="jurisdiction" /></label><label>Formation date<input name="formationDate" type="date" /></label><label>Ownership<input name="ownership" /></label>
        <label>Registered agent<input name="registeredAgent" /></label><label>Tax registration<input name="taxRegistration" /></label><label>Annual filing due<input name="annualFilingDue" type="date" /></label>
        <button className="btn" type="submit">Add</button>
      </form></section></aside>
  </div>;
}

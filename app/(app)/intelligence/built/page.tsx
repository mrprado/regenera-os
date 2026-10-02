import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import {
  beCompanyProfiles, beKnowledge, beMatches, beMaterials, beOpportunities, beSignals, beSystems, beTechnologies, bids, contacts, deals, documents, networkProfiles, organizations, procurementPackages, projectAttributes, projects,
} from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { appDb, isInternal, mandateCondition, type UserScope } from "@/lib/db/scoped";
import { builtCommand, builtOverview, capitalGraph, projectsForCompany } from "@/lib/built/engine";
import {
  BE_TABS, CLAIM_STATES, CLIMATES, COMPANY_STAGES, EFFECT, ENGAGEMENT_KINDS, FEE_COMPLIANCE, FEE_MODELS, HAZARDS, IMPORTANCE, KNOWLEDGE_ACCESS, MATCH_CONFIDENCE, MATERIAL_TAGS, MATURITY, OPPORTUNITY_STATUSES,
  PROJECT_TYPES, RECORD_ORIGINS, REGIONS, REL_STATUSES, SIGNAL_TYPES, STACK_CATEGORIES, TAXONOMY, type BeTab,
} from "@/lib/built/vocab";
import { PACKAGE_STAGES } from "@/lib/procurement/vocab";
import {
  addClaimAction, addMaterialAction, addTechnologyAction, createPartnershipAction, loadBuiltDemoAction, matchStatusAction, qualifySupplierAction, rfiFromMatchAction, runBuiltAction, saveCompanyProfileAction, saveKnowledgeAction, saveSignalAction,
} from "../../built-actions";
import f from "../../funding/funding.module.css";
import s from "./built.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Built environment" };
type SP = Record<string, string | undefined>;
const lab = <T extends Record<string, string>>(o: T, k: string | null | undefined) => (k && k in o ? o[k as keyof T] : k ?? "—");
const O = ({ o }: { o: string }) => <span className={s.origin} data-o={o}>{RECORD_ORIGINS[o as keyof typeof RECORD_ORIGINS] ?? o}</span>;

export default async function BuiltPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/intelligence/built");
  const sp = await searchParams;
  const tab: BeTab = sp.tab && sp.tab in BE_TABS ? (sp.tab as BeTab) : "overview";
  const scope = user.scope;
  const db = appDb();
  const [profs, techs, mats, syss] = await Promise.all([
    db.select({ p: beCompanyProfiles, name: organizations.name, country: organizations.country }).from(beCompanyProfiles).innerJoin(organizations, eq(organizations.id, beCompanyProfiles.orgId)).where(mandateCondition(scope, beCompanyProfiles.mandateId)).orderBy(organizations.name),
    db.select().from(beTechnologies).where(mandateCondition(scope, beTechnologies.mandateId)).orderBy(beTechnologies.name),
    db.select().from(beMaterials).where(mandateCondition(scope, beMaterials.mandateId)).orderBy(beMaterials.name),
    db.select().from(beSystems).where(mandateCondition(scope, beSystems.mandateId)).orderBy(beSystems.name),
  ]);
  const orgName = new Map(profs.map(x => [x.p.orgId, x.name]));
  const open = sp.open ? profs.find(x => x.p.orgId === sp.open) ?? null : null;
  const base = `/intelligence/built?tab=${tab}`;
  const hasDemo = scope.mandateIds.includes("mandate_demo");
  return (
    <>
      <PageHeader title="Built environment" actions={<Link className="btn" href="/intelligence/data">Data catalogue</Link>} />
      <Notice text={sp.notice} />
      <p className={f.kicker}>Construction, materials, building energy, water, resilience and property technology, connected to Regenera&apos;s projects, relationships, capital and procurement</p>
      <nav className={ui.tabs} aria-label="Built environment">
        {Object.entries(BE_TABS).map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={k === "overview" ? "/intelligence/built" : `/intelligence/built?tab=${k}`}>{v}</Link>)}
      </nav>
      {profs.length === 0 && techs.length === 0 && (
        <p className={ui.notice}>No built-environment records yet. Add companies from Organizations (profile below), technologies and materials here{hasDemo && isInternal(scope) ? ", or load the DEMO sample." : "."}
          {hasDemo && isInternal(scope) && <form action={loadBuiltDemoAction} style={{ display: "inline", marginLeft: 8 }}><button className={ui.miniBtn} type="submit">Load DEMO sample</button></form>}</p>
      )}
      <div className={s.frame} data-drawer={!!open}>
        <div>
          {tab === "overview" && <Overview scope={scope} profs={profs} techs={techs} />}
          {tab === "map" && <MarketMap profs={profs} sp={sp} />}
          {tab === "companies" && <Companies profs={profs} sp={sp} />}
          {(tab === "technologies" || tab === "energy" || tab === "water") && <Technologies techs={techs.filter(t => tab === "energy" ? t.category === "energy" : tab === "water" ? ["water", "circularity"].includes(t.category) : true)} orgName={orgName} sp={sp} tab={tab} mats={tab === "water" ? mats.filter(m => m.tags.includes("circular")) : []} />}
          {tab === "materials" && <Materials mats={mats} orgName={orgName} sp={sp} internal={isInternal(scope)} scope={scope} />}
          {tab === "systems" && <Systems syss={syss} orgName={orgName} />}
          {tab === "fit" && <Fit scope={scope} sp={sp} orgName={orgName} />}
          {tab === "partnerships" && <Partnerships scope={scope} orgName={orgName} />}
          {tab === "capital" && <Capital scope={scope} profs={profs} />}
          {tab === "signals" && <Signals scope={scope} profs={profs} />}
          {tab === "regions" && <Regions profs={profs} techs={techs} mats={mats} />}
          {tab === "procurement" && <Procurement scope={scope} />}
        </div>
        {open && <Drawer x={open} scope={scope} techs={techs.filter(t => t.orgId === open.p.orgId)} back={`${base}&open=${open.p.orgId}`} close={base} />}
      </div>
    </>
  );
}

type Prof = { p: typeof beCompanyProfiles.$inferSelect; name: string; country: string | null };
type Tech = typeof beTechnologies.$inferSelect;
type Mat = typeof beMaterials.$inferSelect;

async function Overview({ scope, profs, techs }: { scope: UserScope; profs: Prof[]; techs: Tech[] }) {
  const db = appDb();
  const [o, attention, sigs, matches, opps] = await Promise.all([
    builtOverview(db, scope.mandateIds), builtCommand(db, scope.mandateIds),
    db.select().from(beSignals).where(mandateCondition(scope, beSignals.mandateId)).orderBy(desc(beSignals.date)).limit(40),
    db.select({ m: beMatches, project: projects.name }).from(beMatches).innerJoin(projects, eq(projects.id, beMatches.projectId)).where(and(mandateCondition(scope, beMatches.mandateId), eq(beMatches.confidence, "high"))).orderBy(desc(beMatches.runAt)).limit(8),
    db.select().from(beOpportunities).where(mandateCondition(scope, beOpportunities.mandateId)).orderBy(desc(beOpportunities.updatedAt)).limit(6),
  ]);
  if (!o) return null;
  const expansion = sigs.filter(x => x.type === "geographic_expansion");
  const latam = expansion.filter(x => x.region === "latin_america" || /mexico|latam|latin/i.test(x.summary));
  const raised = sigs.filter(x => x.type === "funding_round");
  const brief = profs.length ? [
    latam.length ? `${latam.length} tracked compan${latam.length === 1 ? "y has" : "ies have"} signalled expansion into Latin America.` : null,
    matches.length ? `${new Set(matches.map(m => m.project)).size} project(s) have high-confidence solution matches.` : null,
    raised.length ? `${raised.length} funding round(s) recorded in the last signals${profs.filter(x => x.p.partnershipInterest).length ? `; ${profs.filter(x => x.p.partnershipInterest).length} companies say they seek project partners` : ""}.` : null,
  ].filter(Boolean).join(" ") : "";
  return (
    <>
      {brief && <p className={s.brief}>{brief} <span className={ui.sub}>Assembled from records and signals; sample (DEMO) records are marked.</span></p>}
      <div className={ui.stats}>
        <div className={ui.stat}><b>{o.companies}</b><span>Built environment companies</span></div><div className={ui.stat}><b>{o.technologies}</b><span>Technologies tracked</span></div>
        <div className={ui.stat}><b>{o.partnerships}</b><span>Active partnerships</span></div><div className={ui.stat}><b>{o.matches}</b><span>Project matches</span></div>
        <div className={ui.stat}><b>{o.rfps.length}</b><span>Procurement opportunities</span></div><div className={ui.stat}><b>{o.capitalOpps}</b><span>Capital opportunities</span></div>
        <div className={ui.stat}><b>{o.signals30}</b><span>New signals, 30 days</span></div><div className={ui.stat}><b>{o.activeRfps}</b><span>Active RFIs / RFPs</span></div>
      </div>
      <div className={r.grid}>
        <div>
          <section className={r.panel}><p className={r.panelTitle}>Needs attention</p>
            {attention.length === 0 ? <p className={r.empty}>No high-importance signals, RFP deadlines or new matches.</p> : <ul className={r.timeline}>{attention.map(a => <li key={a.key}><span className={r.when}>{a.kind}</span><span><Link href={a.href}>{a.text}</Link><span className={ui.sub} style={{ display: "block" }}>{a.why}</span></span></li>)}</ul>}
          </section>
          <section className={r.panel}><p className={r.panelTitle}><span>Project matches</span><Link href="/intelligence/built?tab=fit">Project fit</Link></p>
            {matches.length === 0 ? <p className={r.empty}>Run built environment intelligence on a project.</p> : <table className={ui.table}><tbody>{matches.map(m => <tr key={m.m.id}><td><Link href={`/projects/${m.m.projectId}?tab=built`}>{m.project}</Link></td><td>{STACK_CATEGORIES[m.m.category as keyof typeof STACK_CATEGORIES]}</td><td className={ui.wrap}>{m.m.label}<span className={ui.sub}>{m.m.reason}</span></td></tr>)}</tbody></table>}
          </section>
          <section className={r.panel}><p className={r.panelTitle}><span>New technologies</span><Link href="/intelligence/built?tab=technologies">All</Link></p>
            <table className={ui.table}><tbody>{[...techs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map(t => <tr key={t.id}><td>{t.name}<O o={t.origin} /></td><td>{lab(TAXONOMY_LABELS, t.category)}</td><td>{lab(MATURITY, t.maturity)}</td></tr>)}</tbody></table>
          </section>
        </div>
        <aside>
          <section className={r.panel}><p className={r.panelTitle}><span>Market signals</span><Link href="/intelligence/built?tab=signals">All</Link></p>
            <ul className={r.timeline}>{sigs.slice(0, 6).map(x => <li key={x.id}><span className={r.when}>{x.date}</span><span>{x.summary}<O o={x.origin} /></span></li>)}</ul>
          </section>
          <section className={r.panel}><p className={r.panelTitle}>Capital activity</p><ul className={r.timeline}>{sigs.filter(x => SIGNAL_TYPES[x.type as keyof typeof SIGNAL_TYPES]?.group === "capital" || x.type === "funding_round").slice(0, 4).map(x => <li key={x.id}><span className={r.when}>{x.date}</span><span>{x.summary}</span></li>)}</ul></section>
          <section className={r.panel}><p className={r.panelTitle}>Regulatory changes</p><ul className={r.timeline}>{sigs.filter(x => SIGNAL_TYPES[x.type as keyof typeof SIGNAL_TYPES]?.group === "policy").slice(0, 4).map(x => <li key={x.id}><span className={r.when}>{x.date}</span><span>{x.summary}</span></li>)}</ul></section>
          <section className={r.panel}><p className={r.panelTitle}>Geographic expansion</p><ul className={r.timeline}>{expansion.slice(0, 4).map(x => <li key={x.id}><span className={r.when}>{lab(REGIONS, x.region)}</span><span>{x.summary}</span></li>)}</ul></section>
          <section className={r.panel}><p className={r.panelTitle}><span>Active partnerships</span><Link href="/intelligence/built?tab=partnerships">All</Link></p><ul className={r.timeline}>{opps.map(x => <li key={x.id}><span className={r.when}>{lab(OPPORTUNITY_STATUSES, x.status)}</span><span>{x.dealId ? <Link href={`/deals/${x.dealId}`}>{x.title}</Link> : x.title}</span></li>)}</ul></section>
          <section className={r.panel}><p className={r.panelTitle}><span>Procurement</span><Link href="/intelligence/built?tab=procurement">All</Link></p><ul className={r.timeline}>{o.rfps.slice(0, 5).map(x => <li key={x.id}><span className={r.when}>{x.due ?? "—"}</span><span><Link href={`/projects/${x.projectId}?tab=procurement&pkg=${x.id}`}>{x.name}</Link></span></li>)}</ul></section>
        </aside>
      </div>
    </>
  );
}

const TAXONOMY_LABELS = Object.fromEntries(Object.entries(TAXONOMY).map(([k, v]) => [k, v.label])) as Record<string, string>;

function MarketMap({ profs, sp }: { profs: Prof[]; sp: SP }) {
  const axis = (["category", "stage", "maturity", "region", "fit"] as const).find(a => a === sp.axis) ?? "category";
  const groups: [string, string][] = axis === "category" ? Object.entries(TAXONOMY_LABELS) : axis === "stage" ? Object.entries(COMPANY_STAGES) : axis === "maturity" ? Object.entries(MATURITY) : axis === "region" ? Object.entries(REGIONS) : Object.entries(PROJECT_TYPES);
  const inGroup = (x: Prof, g: string) => axis === "category" ? x.p.taxonomy.includes(g) : axis === "stage" ? x.p.fundingStage === g : axis === "maturity" ? x.p.maturity === g : axis === "region" ? x.p.operatingRegions.includes(g) || x.p.targetRegions.includes(g) : x.p.buildingSegments.includes(g);
  return (
    <>
      <nav className={ui.tabs} aria-label="Axis" style={{ marginTop: 0 }}>
        {[["category", "By category"], ["stage", "By company stage"], ["maturity", "By commercial maturity"], ["region", "By geography"], ["fit", "By project fit"]].map(([k, v]) => <Link key={k} className={`${ui.tab} ${axis === k ? ui.tabActive : ""}`} href={`/intelligence/built?tab=map&axis=${k}`}>{v}</Link>)}
      </nav>
      <div className={s.map}>{groups.map(([k, label]) => { const list = profs.filter(x => inGroup(x, k)); return (
        <div key={k} className={s.col}><h3><span>{label}</span><span>{list.length}</span></h3>
          <ul>{list.map(x => <li key={x.p.id}><Link href={`/intelligence/built?tab=map&axis=${axis}&open=${x.p.orgId}`} aria-current={sp.open === x.p.orgId}><span>{x.name.replace("DEMO — ", "")}</span><small>{lab(MATURITY, x.p.maturity)}</small></Link></li>)}</ul>
        </div>); })}</div>
      <p className={ui.sub}>Original Regenera market map. Select a company to open its drawer. Sample (DEMO) organizations are fictional.</p>
    </>
  );
}

function Companies({ profs, sp }: { profs: Prof[]; sp: SP }) {
  const q = sp.q?.toLowerCase();
  const rows = profs.filter(x => (!q || `${x.name} ${x.p.subsectors.join(" ")} ${x.p.summary}`.toLowerCase().includes(q)) && (!sp.taxonomy || x.p.taxonomy.includes(sp.taxonomy)) && (!sp.region || x.p.operatingRegions.includes(sp.region) || x.p.targetRegions.includes(sp.region))
    && (!sp.stage || x.p.fundingStage === sp.stage) && (!sp.maturity || x.p.maturity === sp.maturity) && (!sp.segment || x.p.buildingSegments.includes(sp.segment)) && (!sp.rel || x.p.relationshipStatus === sp.rel));
  return (
    <>
      <form action={withBase("/intelligence/built")} className={f.inline} style={{ marginBottom: 10 }}>
        <input type="hidden" name="tab" value="companies" />
        <input name="q" defaultValue={sp.q} placeholder="low carbon concrete, modular…" aria-label="Search" />
        <select name="taxonomy" defaultValue={sp.taxonomy ?? ""} aria-label="Sector"><option value="">Any sector</option>{Object.entries(TAXONOMY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="region" defaultValue={sp.region ?? ""} aria-label="Geography"><option value="">Any geography</option>{Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="stage" defaultValue={sp.stage ?? ""} aria-label="Funding stage"><option value="">Any stage</option>{Object.entries(COMPANY_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="maturity" defaultValue={sp.maturity ?? ""} aria-label="Maturity"><option value="">Any maturity</option>{Object.entries(MATURITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="segment" defaultValue={sp.segment ?? ""} aria-label="Building type"><option value="">Any building type</option>{Object.entries(PROJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="rel" defaultValue={sp.rel ?? ""} aria-label="Relationship"><option value="">Any relationship</option>{Object.entries(REL_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
      </form>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Company</th><th>Category · subsector</th><th>Maturity</th><th>Stage</th><th>Regions</th><th>Project types</th><th>Relationship</th></tr></thead>
        <tbody>{rows.map(x => (
          <tr key={x.p.id}><td className={ui.wrap}><Link className={ui.primary} href={`/intelligence/built?tab=companies&open=${x.p.orgId}`}>{x.name}</Link><O o={x.p.origin} /><span className={ui.sub}>{x.p.summary.slice(0, 90)}</span></td>
            <td className={ui.wrap}>{x.p.taxonomy.map(t => lab(TAXONOMY_LABELS, t)).join(", ")}<span className={ui.sub}>{x.p.subsectors.join(", ")}</span></td><td>{lab(MATURITY, x.p.maturity)}</td><td>{lab(COMPANY_STAGES, x.p.fundingStage)}</td>
            <td className={ui.wrap}>{x.p.operatingRegions.map(g => lab(REGIONS, g)).join(", ")}{x.p.expansionStatus && <span className={ui.sub}>{x.p.expansionStatus}</span>}</td><td className={ui.sub}>{x.p.buildingSegments.map(g => lab(PROJECT_TYPES, g)).join(", ")}</td><td>{lab(REL_STATUSES, x.p.relationshipStatus)}</td></tr>
        ))}</tbody>
      </table></div>
      {rows.length === 0 && <p className={r.empty}>No company matches. Add a profile from an organization&apos;s drawer (Organizations → a company → Built environment profile) or below.</p>}
    </>
  );
}

function Technologies({ techs, orgName, sp, tab, mats }: { techs: Tech[]; orgName: Map<string, string>; sp: SP; tab: string; mats: Mat[] }) {
  const rows = techs.filter(t => (!sp.climate || !t.climates.length || t.climates.includes(sp.climate)) && (!sp.btype || t.buildingTypes.includes(sp.btype)) && (!sp.maturity || t.maturity === sp.maturity) && (!sp.q || t.name.toLowerCase().includes(sp.q.toLowerCase())));
  return (
    <>
      <form action={withBase("/intelligence/built")} className={f.inline} style={{ marginBottom: 10 }}>
        <input type="hidden" name="tab" value={tab} /><input name="q" defaultValue={sp.q} placeholder="Search" aria-label="Search" />
        <select name="climate" defaultValue={sp.climate ?? ""} aria-label="Climate"><option value="">Any climate</option>{Object.entries(CLIMATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="btype" defaultValue={sp.btype ?? ""} aria-label="Building type"><option value="">Any building type</option>{Object.entries(PROJECT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="maturity" defaultValue={sp.maturity ?? ""} aria-label="Maturity"><option value="">Any maturity</option>{Object.entries(MATURITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
      </form>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Technology</th><th>Provider</th><th>Category</th><th>TRL · maturity</th><th>Climates · hazards</th><th>Building types</th><th>Effects</th><th>Bankability</th></tr></thead>
        <tbody>{rows.map(t => (
          <tr key={t.id}><td className={ui.wrap}>{t.name}<O o={t.origin} /></td><td>{t.orgId ? <Link href={`/intelligence/built?tab=${tab}&open=${t.orgId}`}>{orgName.get(t.orgId) ?? "—"}</Link> : "—"}</td><td>{lab(TAXONOMY_LABELS, t.category)}<span className={ui.sub}>{t.subcategory}</span></td>
            <td>{t.trl ? `TRL ${t.trl}` : "—"}<span className={ui.sub}>{lab(MATURITY, t.maturity)}</span></td><td className={ui.sub}>{[...t.climates.map(c => lab(CLIMATES, c)), ...t.hazards.map(h => lab(HAZARDS, h))].join(", ") || "Any"}</td>
            <td className={ui.sub}>{t.buildingTypes.map(b => lab(PROJECT_TYPES, b)).join(", ") || "Any"}</td><td className={ui.sub}>{Object.entries(t.effects).filter(([, v]) => v && v !== "unknown").map(([k, v]) => `${k}: ${lab(EFFECT, v)}`).join(", ") || "Not recorded"}</td><td>{t.bankability}</td></tr>
        ))}</tbody>
      </table></div>
      {mats.length > 0 && <><p className={f.kicker} style={{ marginTop: 16 }}>Circular materials</p><table className={ui.table}><tbody>{mats.map(m => <tr key={m.id}><td>{m.name}<O o={m.origin} /></td><td>{m.family}</td></tr>)}</tbody></table></>}
      <details className={r.panel} style={{ marginTop: 14 }}><summary className={ui.primary}>Add a technology</summary>
        <form action={addTechnologyAction} className={f.grid3} style={{ marginTop: 8 }}>
          <input type="hidden" name="back" value={`/intelligence/built?tab=${tab}`} />
          <label>Name<input name="name" required /></label>
          <label>Category<select name="category" defaultValue={tab === "energy" ? "energy" : tab === "water" ? "water" : "construction"}>{Object.entries(TAXONOMY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Subcategory<input name="subcategory" /></label>
          <label>Maturity<select name="maturity">{Object.entries(MATURITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>TRL<input name="trl" inputMode="numeric" /></label>
          <label>Source URL<input name="sourceUrl" type="url" /></label>
          <fieldset className={`${f.full} ${s.checks}`}><legend className={ui.sub}>Climates</legend>{Object.entries(CLIMATES).map(([k, v]) => <label key={k}><input type="checkbox" name="climates" value={k} /> {v}</label>)}</fieldset>
          <fieldset className={`${f.full} ${s.checks}`}><legend className={ui.sub}>Building types</legend>{Object.entries(PROJECT_TYPES).map(([k, v]) => <label key={k}><input type="checkbox" name="buildingTypes" value={k} /> {v}</label>)}</fieldset>
          <div><button className="btn btn--primary" type="submit">Add</button></div>
        </form>
      </details>
    </>
  );
}

async function Materials({ mats, orgName, sp, internal, scope }: { mats: Mat[]; orgName: Map<string, string>; sp: SP; internal: boolean; scope: UserScope }) {
  const tag = sp.mtag && sp.mtag in MATERIAL_TAGS ? sp.mtag : null;
  const cl = sp.climate && (sp.climate in CLIMATES || sp.climate in HAZARDS) ? sp.climate : null;
  const rows = mats.filter(m => (!tag || m.tags.includes(tag)) && (!cl || m.climates.includes(cl) || m.hazards.includes(cl)));
  const knowledge = await appDb().select().from(beKnowledge).where(mandateCondition(scope, beKnowledge.mandateId)).orderBy(desc(beKnowledge.updatedAt));
  return (
    <>
      <nav className={ui.tabs} style={{ marginTop: 0 }} aria-label="Material filters">
        <Link className={`${ui.tab} ${!tag && !cl ? ui.tabActive : ""}`} href="/intelligence/built?tab=materials">All</Link>
        {Object.entries(MATERIAL_TAGS).map(([k, v]) => <Link key={k} className={`${ui.tab} ${tag === k ? ui.tabActive : ""}`} href={`/intelligence/built?tab=materials&mtag=${k}`}>{v}</Link>)}
        {[["tropical_humid", "Wet / tropical"], ["arid", "Dry climate"], ["coastal", "Coastal"], ["seismic", "Seismic"], ["wildfire", "Wildfire"], ["hurricane", "Hurricane"]].map(([k, v]) => <Link key={k} className={`${ui.tab} ${cl === k ? ui.tabActive : ""}`} href={`/intelligence/built?tab=materials&climate=${k}`}>{v}</Link>)}
      </nav>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Material</th><th>Family</th><th>Supplier</th><th>Embodied carbon</th><th>Tags</th><th>Climate · hazard suitability</th><th>Local availability</th><th>Cost · lead time</th></tr></thead>
        <tbody>{rows.map(m => (
          <tr key={m.id}><td className={ui.wrap}>{m.name}<O o={m.origin} /></td><td>{m.family}</td><td>{m.supplierOrgId ? <Link href={`/intelligence/built?tab=materials&open=${m.supplierOrgId}`}>{orgName.get(m.supplierOrgId) ?? "—"}</Link> : "—"}</td>
            <td>{m.embodiedCarbon != null ? `${m.embodiedCarbon} ${m.embodiedCarbonUnit}` : "Not recorded"}<span className={ui.sub}>{lab(CLAIM_STATES, m.embodiedCarbonState)}{m.epdId ? " · EPD" : ""}</span></td>
            <td className={ui.sub}>{m.tags.map(t => lab(MATERIAL_TAGS, t)).join(", ")}</td><td className={ui.sub}>{[...m.climates.map(c => lab(CLIMATES, c)), ...m.hazards.map(h => lab(HAZARDS, h))].join(", ") || "—"}</td>
            <td className={ui.sub}>{m.localAvailability.map(g => lab(REGIONS, g)).join(", ") || "—"}</td><td className={ui.sub}>{m.cost || "—"}{m.leadTime ? ` · ${m.leadTime}` : ""}</td></tr>
        ))}</tbody>
      </table></div>
      <p className={ui.sub}>Embodied carbon is shown only from an EPD (Network → EPD library) or a claim with its state. Words like carbon-negative, sustainable, regenerative or zero carbon are refused on a record without a supporting claim.</p>
      <details className={r.panel}><summary className={ui.primary}>Add a material</summary>
        <form action={addMaterialAction} className={f.grid3} style={{ marginTop: 8 }}>
          <label>Name<input name="name" required /></label><label>Family<select name="family">{TAXONOMY.materials.items.map(i => <option key={i} value={i}>{i}</option>)}</select></label><label>Origin<input name="originPlace" /></label>
          <fieldset className={`${f.full} ${s.checks}`}><legend className={ui.sub}>Tags</legend>{Object.entries(MATERIAL_TAGS).map(([k, v]) => <label key={k}><input type="checkbox" name="tags" value={k} /> {v}</label>)}</fieldset>
          <fieldset className={`${f.full} ${s.checks}`}><legend className={ui.sub}>Suitability</legend>{Object.entries(CLIMATES).map(([k, v]) => <label key={k}><input type="checkbox" name="climates" value={k} /> {v}</label>)}{Object.entries(HAZARDS).map(([k, v]) => <label key={k}><input type="checkbox" name="hazards" value={k} /> {v}</label>)}</fieldset>
          <div><button className="btn btn--primary" type="submit">Add</button></div>
        </form>
      </details>
      <section className={r.panel} id="knowledge">
        <p className={r.panelTitle}><span>Traditional / vernacular / place-based building knowledge</span><span className={ui.sub}>Governed: not public, not searchable, never sent to Ask the OS or MCP</span></p>
        {knowledge.length === 0 ? <p className={r.empty}>No governed records.</p> : (
          <table className={ui.table}><thead><tr><th>Record</th><th>Community · custodian</th><th>Access</th><th>Consent</th><th>Commercial use</th><th>Benefit-sharing</th></tr></thead><tbody>
            {knowledge.map(k => <tr key={k.id}><td className={ui.wrap}>{k.title}<span className={ui.sub}>{["public", "internal"].includes(k.access) ? k.summary.slice(0, 140) : "Content held under the community's terms"}</span></td><td>{[k.community, k.custodian].filter(Boolean).join(" · ") || "—"}</td>
              <td>{lab(KNOWLEDGE_ACCESS, k.access)}</td><td>{k.consentStatus.replace(/_/g, " ")}</td><td>{k.commercialUse ? "Permitted" : "No"}</td><td>{k.benefitSharingRequired ? k.benefitSharing || "Required · not yet agreed" : "Not required"}</td></tr>)}
          </tbody></table>
        )}
        {internal && (
          <details><summary className={ui.sub}>Record governed knowledge</summary>
            <form action={saveKnowledgeAction} className={f.grid3} style={{ marginTop: 8 }}>
              <label>Title<input name="title" required /></label><label>Knowledge type<input name="knowledgeType" list="vk" /></label><label>Access<select name="access" defaultValue="community_governed">{Object.entries(KNOWLEDGE_ACCESS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Community<input name="community" /></label><label>Custodian<input name="custodian" /></label><label>Knowledge holder<input name="knowledgeHolder" /></label>
              <label>Consent<select name="consentStatus"><option value="not_requested">Not requested</option><option value="requested">Requested</option><option value="granted">Granted</option><option value="refused">Refused</option><option value="withdrawn">Withdrawn</option></select></label>
              <label>Authorized use<input name="authorizedUse" /></label><label>Review / expiry date<input type="date" name="reviewDate" /></label>
              <label className={f.inline}><input type="checkbox" name="commercialUse" /> Commercial use permitted</label><label className={f.inline}><input type="checkbox" name="publication" /> Publication permitted</label><label className={f.inline}><input type="checkbox" name="digitization" /> Digitization permitted</label>
              <label className={f.full}>Benefit-sharing (equity, revenue share, community fund, governance)<input name="benefitSharing" /></label>
              <label className={f.full}>Restrictions<input name="restrictions" /></label>
              <label className={f.full}>Summary (visible only if access is public or internal)<textarea name="summary" /></label>
              <datalist id="vk">{["adobe", "cob", "rammed earth", "lime construction", "stone construction", "vernacular timber", "bamboo", "shaded courtyards", "passive ventilation", "thermal mass", "traditional roofing", "rainwater systems", "settlement morphology", "landscape orientation", "seasonal building logic"].map(v => <option key={v} value={v} />)}</datalist>
              <div><button className="btn btn--primary" type="submit">Save governed record</button></div>
            </form>
          </details>
        )}
      </section>
    </>
  );
}

function Systems({ syss, orgName }: { syss: (typeof beSystems.$inferSelect)[]; orgName: Map<string, string> }) {
  return (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Construction system</th><th>Type</th><th>Climates · hazards</th><th>Building types</th><th>Speed</th><th>Cost</th><th>Embodied carbon</th><th>Providers</th></tr></thead>
      <tbody>{syss.map(x => (
        <tr key={x.id}><td className={ui.wrap}>{x.name}<O o={x.origin} /></td><td>{x.kind}</td><td className={ui.sub}>{[...x.climates.map(c => lab(CLIMATES, c)), ...x.hazards.map(h => lab(HAZARDS, h))].join(", ") || "Any"}</td><td className={ui.sub}>{x.buildingTypes.map(b => lab(PROJECT_TYPES, b)).join(", ")}</td>
          <td>{x.speedEffect === "lower" ? "Faster" : x.speedEffect === "higher" ? "Slower" : lab(EFFECT, x.speedEffect)}</td><td>{lab(EFFECT, x.costEffect)}</td><td>{lab(EFFECT, x.carbonEffect)}</td><td className={ui.sub}>{x.providerOrgIds.map(o => orgName.get(o)).filter(Boolean).join(", ") || "—"}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

async function Fit({ scope, sp, orgName }: { scope: UserScope; sp: SP; orgName: Map<string, string> }) {
  const ps = await appDb().select({ id: projects.id, name: projects.name, country: projects.country, stage: projects.stage }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(projects.name);
  const pid = sp.project && ps.some(p => p.id === sp.project) ? sp.project : ps[0]?.id;
  const matches = pid ? await appDb().select().from(beMatches).where(eq(beMatches.projectId, pid)).orderBy(beMatches.rank) : [];
  const project = ps.find(p => p.id === pid);
  return (
    <>
      <form action={withBase("/intelligence/built")} className={f.inline} style={{ marginBottom: 10 }}><input type="hidden" name="tab" value="fit" />
        <select name="project" defaultValue={pid} aria-label="Project">{ps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="btn" type="submit">Show</button></form>
      {project && <form action={runBuiltAction} style={{ marginBottom: 12 }}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="back" value={`/intelligence/built?tab=fit&project=${project.id}`} /><button className="btn btn--primary" type="submit">Run built environment intelligence</button> <span className={ui.sub}>Climate and hazards are inferred from location and site-intelligence facts; each recommendation says why.</span></form>}
      <StackView matches={matches} orgName={orgName} back={`/intelligence/built?tab=fit&project=${pid ?? ""}`} />
    </>
  );
}

function StackView({ matches, orgName, back }: { matches: (typeof beMatches.$inferSelect)[]; orgName: Map<string, string>; back: string }) {
  if (!matches.length) return <p className={r.empty}>No recommendations yet. Run built environment intelligence.</p>;
  const cats = Object.keys(STACK_CATEGORIES).filter(c => matches.some(m => m.category === c));
  return (
    <div className={s.stack}>{cats.map(c => (
      <section key={c}><h3>{STACK_CATEGORIES[c as keyof typeof STACK_CATEGORIES]}</h3>
        <ol>{matches.filter(m => m.category === c && m.status !== "rejected").map(m => (
          <li key={m.id}><b>{m.label.replace("DEMO — ", "")}</b> <span className={ui.chip}>{MATCH_CONFIDENCE[m.confidence as keyof typeof MATCH_CONFIDENCE]}</span>{m.status === "shortlisted" && <span className={ui.chip}>Shortlisted</span>}
            <span className={ui.sub} style={{ display: "block" }}>Why: {m.reason}</span>
            <span className={ui.sub} style={{ display: "block" }}>Cost {lab(EFFECT, m.impacts.cost)} · schedule {lab(EFFECT, m.impacts.schedule)} · carbon {lab(EFFECT, m.impacts.carbon)} · resilience {m.impacts.resilience === "lower" ? "risk reduced" : lab(EFFECT, m.impacts.resilience)} · {m.stageFit}</span>
            {m.providerOrgIds.length > 0 && <span className={ui.sub} style={{ display: "block" }}>Providers: {m.providerOrgIds.map(o => orgName.get(o)).filter(Boolean).join(", ")}</span>}
            <span className={ui.rowActions} style={{ marginTop: 4 }}>
              {m.status !== "shortlisted" && <form action={matchStatusAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="shortlisted" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Shortlist</button></form>}
              <form action={matchStatusAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="rejected" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Not a fit</button></form>
              {m.subjectType !== "strategy" && <form action={rfiFromMatchAction}><input type="hidden" name="id" value={m.id} /><button className={ui.miniBtn} type="submit">Open RFI</button></form>}
            </span>
          </li>
        ))}</ol>
      </section>
    ))}</div>
  );
}

async function Partnerships({ scope, orgName }: { scope: UserScope; orgName: Map<string, string> }) {
  const rows = await appDb().select({ o: beOpportunities, stage: deals.stage }).from(beOpportunities).leftJoin(deals, eq(deals.id, beOpportunities.dealId)).where(mandateCondition(scope, beOpportunities.mandateId)).orderBy(desc(beOpportunities.updatedAt));
  return rows.length === 0 ? <p className={r.empty}>No partnership opportunities. Open a company and use Create partnership opportunity.</p> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Opportunity</th><th>Company</th><th>Engagement</th><th>Fee models</th><th>Fee compliance</th><th>Status</th><th>Deal</th></tr></thead>
      <tbody>{rows.map(({ o, stage }) => (
        <tr key={o.id}><td className={ui.wrap}>{o.title}<span className={ui.sub}>{o.regeneraAssets}</span></td><td><Link href={`/intelligence/built?tab=partnerships&open=${o.orgId}`}>{orgName.get(o.orgId) ?? "—"}</Link></td>
          <td className={ui.sub}>{o.kinds.map(k => lab(ENGAGEMENT_KINDS, k)).join(", ")}</td><td className={ui.sub}>{o.feeModels.map(k => lab(FEE_MODELS, k)).join(", ") || "—"}</td>
          <td className={o.feeCompliance === "review_required" ? f.warn : undefined}>{lab(FEE_COMPLIANCE, o.feeCompliance)}</td><td>{lab(OPPORTUNITY_STATUSES, o.status)}</td><td>{o.dealId ? <Link href={`/deals/${o.dealId}`}>{stage ?? "Open"}</Link> : "—"}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

async function Capital({ scope, profs }: { scope: UserScope; profs: Prof[] }) {
  const g = await capitalGraph(appDb(), scope.mandateIds);
  const raising = profs.filter(x => x.p.fundingStage && ["seed", "series_a", "series_b", "growth"].includes(x.p.fundingStage));
  return (
    <div className={r.grid}>
      <section className={r.panel}><p className={r.panelTitle}>Investor → portfolio</p>
        {g.investors.length === 0 ? <p className={r.empty}>No investors recorded on company profiles.</p> : <table className={ui.table}><tbody>{g.investors.map(i => <tr key={i.name}><td>{i.id ? <Link href={`/companies/${i.id}`}>{i.name}</Link> : i.name}</td><td className={ui.sub}>{i.portfolio.map(p => p.name.replace("DEMO — ", "")).join(", ")}</td></tr>)}</tbody></table>}
        <p className={ui.sub}>Investor → portfolio company → technology → Regenera project → developer → project finance → offtaker: follow a company&apos;s drawer to its matched projects and deals.</p>
      </section>
      <aside><section className={r.panel}><p className={r.panelTitle}>Venture-stage companies</p>
        <table className={ui.table}><tbody>{raising.map(x => <tr key={x.p.id}><td><Link href={`/intelligence/built?tab=capital&open=${x.p.orgId}`}>{x.name.replace("DEMO — ", "")}</Link></td><td>{lab(COMPANY_STAGES, x.p.fundingStage)}</td><td className={ui.sub}>{x.p.capitalRaised ? `${x.p.capitalRaised} ${x.p.capitalCurrency}` : "Amount not recorded"}</td></tr>)}</tbody></table>
      </section></aside>
    </div>
  );
}

async function Signals({ scope, profs }: { scope: UserScope; profs: Prof[] }) {
  const rows = await appDb().select().from(beSignals).where(mandateCondition(scope, beSignals.mandateId)).orderBy(desc(beSignals.date)).limit(200);
  return (
    <>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Date</th><th>Signal</th><th>Entity</th><th>Type</th><th>Region</th><th>Importance</th><th>Why it matters · next action</th><th>Source</th></tr></thead>
        <tbody>{rows.map(x => (
          <tr key={x.id}><td>{x.date}</td><td className={ui.wrap}>{x.summary}<O o={x.origin} /></td><td>{x.orgId ? <Link href={`/intelligence/built?tab=signals&open=${x.orgId}`}>{x.entity.replace("DEMO — ", "")}</Link> : x.entity}</td>
            <td>{lab(Object.fromEntries(Object.entries(SIGNAL_TYPES).map(([k, v]) => [k, v.label])), x.type)}</td><td>{lab(REGIONS, x.region)}</td><td>{lab(IMPORTANCE, x.importance)}</td>
            <td className={ui.wrap}>{x.why}<span className={ui.sub}>{x.suggestedAction}</span></td><td className={ui.sub}>{x.sourceUrl ? <a href={x.sourceUrl} target="_blank" rel="noreferrer">{x.source}</a> : x.source}</td></tr>
        ))}</tbody>
      </table></div>
      <details className={r.panel} style={{ marginTop: 14 }}><summary className={ui.primary}>Record a signal (with its source)</summary>
        <form action={saveSignalAction} className={f.grid3} style={{ marginTop: 8 }}>
          <label>Date<input type="date" name="date" required /></label>
          <label>Company<select name="orgId" defaultValue=""><option value="">Not a tracked company</option>{profs.map(x => <option key={x.p.orgId} value={x.p.orgId}>{x.name}</option>)}</select></label>
          <label>Entity (if not tracked)<input name="entity" /></label>
          <label>Type<select name="type">{Object.entries(SIGNAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Region<select name="region" defaultValue=""><option value="">—</option>{Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Importance<select name="importance" defaultValue="medium">{Object.entries(IMPORTANCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={f.full}>Summary<input name="summary" required /></label>
          <label>Source<input name="source" required placeholder="Publication, filing, press release" /></label><label>Source URL<input name="sourceUrl" type="url" /></label>
          <label>Why it matters<input name="why" /></label><label className={f.full}>Suggested action<input name="suggestedAction" /></label>
          <div><button className="btn btn--primary" type="submit">Record</button></div>
        </form>
      </details>
    </>
  );
}

function Regions({ profs, techs, mats }: { profs: Prof[]; techs: Tech[]; mats: Mat[] }) {
  return (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Region</th><th className={ui.num}>Companies operating</th><th className={ui.num}>Targeting / expanding</th><th className={ui.num}>Locally available materials</th><th>Categories</th></tr></thead>
      <tbody>{Object.entries(REGIONS).map(([k, v]) => { const op = profs.filter(x => x.p.operatingRegions.includes(k)); const tg = profs.filter(x => x.p.targetRegions.includes(k) && !x.p.operatingRegions.includes(k)); return (
        <tr key={k}><td>{v}</td><td className={ui.num}>{op.length}</td><td className={ui.num}>{tg.length}</td><td className={ui.num}>{mats.filter(m => m.localAvailability.includes(k)).length}</td><td className={ui.sub}>{[...new Set(op.flatMap(x => x.p.taxonomy))].map(t => lab(TAXONOMY_LABELS, t)).join(", ")}</td></tr>); })}</tbody>
    </table>
    <p className={ui.sub}>{techs.length} technologies tracked in total.</p></div>
  );
}

async function Procurement({ scope }: { scope: UserScope }) {
  const [pkgs, sup] = await Promise.all([
    appDb().select({ k: procurementPackages, project: projects.name }).from(procurementPackages).innerJoin(projects, eq(projects.id, procurementPackages.projectId)).where(and(mandateCondition(scope, procurementPackages.mandateId), inArray(procurementPackages.stage, ["need", "rfi", "rfp", "bids", "clarification", "evaluation", "bafo", "selection", "negotiation"]))).orderBy(procurementPackages.bidsDueAt),
    appDb().select({ n: networkProfiles, name: organizations.name }).from(networkProfiles).innerJoin(organizations, eq(organizations.id, networkProfiles.orgId)).where(mandateCondition(scope, networkProfiles.mandateId)).orderBy(organizations.name).limit(200),
  ]);
  const ids = pkgs.map(p => p.k.id);
  const bidRows = ids.length ? await appDb().select({ packageId: bids.packageId, status: bids.status }).from(bids).where(inArray(bids.packageId, ids.slice(0, 90))) : [];
  return (
    <>
      <p className={ui.notice}>Project need → solution category → supplier shortlist → technical and commercial screen → RFI → RFP → bid comparison (criterion by criterion, not one score) → negotiation → selection → contract → deployment → performance. Packages and bids live in each project&apos;s Procurement tab.</p>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Package</th><th>Project</th><th>Stage</th><th>Responses due</th><th className={ui.num}>Invited / received</th></tr></thead>
        <tbody>{pkgs.map(p => <tr key={p.k.id}><td><Link href={`/projects/${p.k.projectId}?tab=procurement&pkg=${p.k.id}`}>{p.k.name}</Link></td><td>{p.project}</td><td>{PACKAGE_STAGES[p.k.stage as keyof typeof PACKAGE_STAGES]}</td><td>{p.k.bidsDueAt ?? "—"}</td>
          <td className={ui.num}>{bidRows.filter(b => b.packageId === p.k.id).length} / {bidRows.filter(b => b.packageId === p.k.id && !["invited", "declined"].includes(b.status)).length}</td></tr>)}</tbody>
      </table></div>
      <section className={r.panel} style={{ marginTop: 14 }}>
        <p className={r.panelTitle}><span>Supplier qualification</span><Link href="/network">Ecosystem network</Link></p>
        <table className={ui.table}><thead><tr><th>Supplier</th><th>Status</th><th>Technical · financial</th><th>Insurance · certifications</th><th>Warranty · delivery · payment</th><th /></tr></thead>
          <tbody>{sup.map(x => (
            <tr key={x.n.id}><td>{x.name}</td><td>{x.n.approvedStatus.replace(/_/g, " ")}</td><td className={ui.sub}>{[x.n.technicalQualification, x.n.financialQualification].filter(Boolean).join(" · ") || "—"}</td><td className={ui.sub}>{[x.n.insurance, x.n.certifications.join(", ")].filter(Boolean).join(" · ") || "—"}</td>
              <td className={ui.sub}>{[x.n.warranty, x.n.deliveryTime, x.n.paymentTerms].filter(Boolean).join(" · ") || "—"}</td>
              <td><details><summary className={ui.miniBtn}>Qualify</summary><form action={qualifySupplierAction} className={f.form} style={{ minWidth: 260 }}>
                <input type="hidden" name="orgId" value={x.n.orgId} />
                <select name="approvedStatus" defaultValue={x.n.approvedStatus} aria-label="Status"><option value="not_assessed">Not assessed</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="conditional">Conditional</option><option value="not_approved">Not approved</option></select>
                <input name="technical" defaultValue={x.n.technicalQualification} placeholder="Technical qualification" /><input name="financial" defaultValue={x.n.financialQualification} placeholder="Financial qualification" />
                <input name="insurance" defaultValue={x.n.insurance} placeholder="Insurance" /><input name="certifications" defaultValue={x.n.certifications.join(", ")} placeholder="Certifications" /><input name="references" defaultValue={x.n.references} placeholder="References" />
                <input name="warranty" defaultValue={x.n.warranty} placeholder="Warranty" /><input name="deliveryTime" defaultValue={x.n.deliveryTime} placeholder="Delivery time" /><input name="paymentTerms" defaultValue={x.n.paymentTerms} placeholder="Payment terms" /><input name="pricingNote" defaultValue={x.n.pricingNote} placeholder="Pricing" />
                <button className={ui.miniBtn} type="submit">Save</button></form></details></td></tr>
          ))}</tbody></table>
      </section>
    </>
  );
}

async function Drawer({ x, scope, techs, back, close }: { x: Prof; scope: UserScope; techs: Tech[]; back: string; close: string }) {
  const db = appDb();
  const [matched, people, claims, packages, docs, ps, opps] = await Promise.all([
    projectsForCompany(db, x.p.orgId),
    db.select({ id: contacts.id, name: contacts.fullName, title: contacts.title }).from(contacts).where(and(eq(contacts.orgId, x.p.orgId), eq(contacts.suppressed, false))).limit(6),
    db.select().from(projectAttributes).where(and(eq(projectAttributes.subjectType, "company"), eq(projectAttributes.subjectId, x.p.orgId))),
    db.select({ id: procurementPackages.id, name: procurementPackages.name, projectId: procurementPackages.projectId, stage: procurementPackages.stage }).from(bids).innerJoin(procurementPackages, eq(procurementPackages.id, bids.packageId)).where(eq(bids.orgId, x.p.orgId)).limit(6),
    db.select({ id: documents.id, title: documents.title, url: documents.url }).from(documents).where(and(mandateCondition(scope, documents.mandateId), eq(documents.counterpartyOrgId, x.p.orgId))).limit(8),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(projects.name),
    db.select({ id: beOpportunities.id, title: beOpportunities.title, dealId: beOpportunities.dealId }).from(beOpportunities).where(eq(beOpportunities.orgId, x.p.orgId)),
  ]);
  const investors = x.p.investorOrgIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, x.p.investorOrgIds)) : [];
  return (
    <aside className={s.drawer}>
      <p className={ui.sub} style={{ margin: 0 }}><Link href={close}>Close</Link> · <Link href={`/companies/${x.p.orgId}`}>Organization record</Link></p>
      <h2>{x.name}<O o={x.p.origin} /></h2>
      <p className={ui.sub} style={{ margin: 0 }}>{x.p.taxonomy.map(t => lab(TAXONOMY_LABELS, t)).join(", ")} · {x.p.subsectors.join(", ")}</p>
      <h3>Company</h3><p style={{ margin: 0 }}>{x.p.summary || "No summary."}</p>{x.p.problemSolved && <p className={ui.sub}>Problem solved: {x.p.problemSolved}</p>}
      <h3>Technology</h3>{techs.length ? <ul>{techs.map(t => <li key={t.id}>{t.name.replace("DEMO — ", "")} · {lab(MATURITY, t.maturity)}{t.trl ? ` · TRL ${t.trl}` : ""}</li>)}</ul> : <p className={ui.sub}>None recorded.</p>}
      <h3>Commercial maturity · regions</h3><p style={{ margin: 0 }}>{lab(MATURITY, x.p.maturity)} · {x.p.operatingRegions.map(g => lab(REGIONS, g)).join(", ") || "—"}{x.p.expansionStatus ? ` · ${x.p.expansionStatus}` : ""}</p>
      <h3>Capital</h3><p style={{ margin: 0 }}>{lab(COMPANY_STAGES, x.p.fundingStage)}{x.p.latestRound ? ` · latest: ${x.p.latestRound}` : ""}{x.p.capitalRaised ? ` · ${x.p.capitalRaised} ${x.p.capitalCurrency}` : " · amount not recorded"}</p>
      {(investors.length > 0 || x.p.investorNames.length > 0) && <ul>{investors.map(i => <li key={i.id}><Link href={`/companies/${i.id}`}>{i.name}</Link></li>)}{x.p.investorNames.map(n => <li key={n}>{n}</li>)}</ul>}
      <h3>Regulatory status · certifications</h3><p style={{ margin: 0 }}>{x.p.certifications.join(", ") || "None recorded"}</p>
      <h3>Sustainability claims</h3>{claims.length ? <ul>{claims.map(c => <li key={c.id}>{c.claim} · <i>{lab(CLAIM_STATES, c.verification)}</i> · {c.source}</li>)}</ul> : <p className={ui.sub}>No claims recorded; none are assumed.</p>}
      <details><summary className={ui.sub}>Record a claim</summary><form action={addClaimAction} className={f.form}><input type="hidden" name="subjectType" value="company" /><input type="hidden" name="subjectId" value={x.p.orgId} /><input type="hidden" name="back" value={back} />
        <input name="claim" required placeholder="Claim" /><input name="source" required placeholder="Source" /><input name="methodology" placeholder="Methodology" /><input name="scope" placeholder="Applicable scope" />
        <select name="verification">{Object.entries(CLAIM_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="verifier" placeholder="Verifier" /><button className={ui.miniBtn} type="submit">Record claim</button></form></details>
      <h3>Regenera project fit</h3>{matched.length ? <ul>{matched.map(m => <li key={m.projectId}><Link href={`/projects/${m.projectId}?tab=built`}>{m.name}</Link> · {m.items.slice(0, 2).map(i => i.replace("DEMO — ", "")).join(", ")}</li>)}</ul> : <p className={ui.sub}>No project matches yet.</p>}
      <h3>Procurement opportunity</h3>{packages.length ? <ul>{packages.map(p => <li key={p.id}><Link href={`/projects/${p.projectId}?tab=procurement&pkg=${p.id}`}>{p.name}</Link> · {PACKAGE_STAGES[p.stage as keyof typeof PACKAGE_STAGES]}</li>)}</ul> : <p className={ui.sub}>Not invited to any package.</p>}
      <h3>People</h3>{people.length ? <ul>{people.map(p => <li key={p.id}><Link href={`/people/${p.id}`}>{p.name}</Link>{p.title ? ` · ${p.title}` : ""}</li>)}</ul> : <p className={ui.sub}>No contacts recorded.</p>}
      <h3>Documents</h3>{docs.length ? <ul>{docs.map(d => <li key={d.id}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : d.title}</li>)}</ul> : <p className={ui.sub}>No documents linked (pitch decks, specifications, certifications, proposals, NDAs, MOUs…).</p>}
      <h3>Partnership opportunity</h3>
      {opps.length > 0 && <ul>{opps.map(o => <li key={o.id}>{o.dealId ? <Link href={`/deals/${o.dealId}`}>{o.title}</Link> : o.title}</li>)}</ul>}
      <details open={!opps.length}><summary className={ui.sub}>Create partnership opportunity</summary>
        <form action={createPartnershipAction} className={f.form}>
          <input type="hidden" name="orgId" value={x.p.orgId} /><input type="hidden" name="back" value={back} />
          <input name="title" required defaultValue={`${x.name.replace("DEMO — ", "")} · ${x.p.expansionStatus ? "market entry" : "partnership"}`} aria-label="Title" />
          <fieldset className={s.checks}><legend className={ui.sub}>Engagement</legend>{(["market_entry", "pilot_site", "introductions", "investor_introductions", "procurement_advisory", "technology_advisory", "strategic_partnership"] as const).map(k => <label key={k}><input type="checkbox" name="kinds" value={k} defaultChecked={k === "pilot_site"} /> {ENGAGEMENT_KINDS[k]}</label>)}</fieldset>
          <fieldset className={s.checks}><legend className={ui.sub}>Projects</legend>{ps.map(p => <label key={p.id}><input type="checkbox" name="projectIds" value={p.id} defaultChecked={matched.some(m => m.projectId === p.id)} /> {p.name.replace("DEMO — ", "")}</label>)}</fieldset>
          <fieldset className={s.checks}><legend className={ui.sub}>Fee model</legend>{Object.entries(FEE_MODELS).map(([k, v]) => <label key={k}><input type="checkbox" name="feeModels" value={k} /> {v}</label>)}</fieldset>
          <input name="regeneraAssets" placeholder="Regenera assets (projects, relationships)" aria-label="Regenera assets" />
          <button className="btn btn--primary" type="submit">Create (deal + outreach task)</button>
        </form>
      </details>
      <h3>Relationship · next action</h3>
      <form action={saveCompanyProfileAction} className={f.form}>
        <input type="hidden" name="orgId" value={x.p.orgId} /><input type="hidden" name="back" value={back} />
        {x.p.taxonomy.map(t => <input key={t} type="hidden" name="taxonomy" value={t} />)}{x.p.operatingRegions.map(t => <input key={t} type="hidden" name="regions" value={t} />)}{x.p.buildingSegments.map(t => <input key={t} type="hidden" name="segments" value={t} />)}
        <input type="hidden" name="maturity" value={x.p.maturity} /><input type="hidden" name="subsectors" value={x.p.subsectors.join(", ")} /><input type="hidden" name="fundingStage" value={x.p.fundingStage ?? ""} /><input type="hidden" name="latestRound" value={x.p.latestRound} /><input type="hidden" name="investorNames" value={x.p.investorNames.join(", ")} /><input type="hidden" name="certifications" value={x.p.certifications.join(", ")} /><input type="hidden" name="problemSolved" value={x.p.problemSolved} />
        <textarea name="summary" defaultValue={x.p.summary} aria-label="Summary" />
        <select name="relationshipStatus" defaultValue={x.p.relationshipStatus} aria-label="Relationship">{Object.entries(REL_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input name="relationshipOwner" defaultValue={x.p.relationshipOwner ?? ""} placeholder="Relationship owner" aria-label="Owner" />
        <input name="nextAction" defaultValue={x.p.nextAction ?? ""} placeholder="Next action" aria-label="Next action" /><input type="date" name="nextActionDate" defaultValue={x.p.nextActionDate ?? ""} aria-label="Next action date" />
        <button className={ui.miniBtn} type="submit">Save</button>
      </form>
    </aside>
  );
}

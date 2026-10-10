import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { apolloConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { leadContext, leadSuggestions, LEAD_ENTITY_TYPES, type LeadEntityType } from "@/lib/leads/context";
import { buildLeadQuery, LEAD_INSTRUMENTS, LEAD_SECTORS, LEAD_WORKFLOWS, type LeadInstrument, type LeadSector, type LeadWorkflow } from "@/lib/leads/matrix";
import CopyButton from "../copy-button";
import { dismissResultsAction, saveResultsAction } from "../../radar-actions";
import { findPeopleAction } from "./actions";
import styles from "../prospecting.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find contacts" };

const TYPE_LABEL: Record<LeadEntityType, string> = { project: "Project", capital_need: "Capital need", bond: "Bond", funding_application: "Funding application", queue_item: "Opportunity", general: "Search" };
const pick = <T extends string>(v: string | undefined, keys: readonly T[]) => (v && (keys as readonly string[]).includes(v) ? (v as T) : null);

/** Phase 27: find the right people for one record's need (role × sector × instrument × country). */
export default async function FindContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/prospecting");
  const sp = await searchParams;
  const type = pick(sp.type, LEAD_ENTITY_TYPES) ?? "general";
  const id = type === "general" ? (user.scope.mandateIds[0] ?? "") : sp.id;
  if (!id) notFound();
  const db = appDb();
  const ctx = await leadContext(db, user.scope, type, id);
  if (!ctx) notFound();
  const workflow = pick(sp.workflow, ctx.workflows) ?? ctx.workflows[0];
  const wf = LEAD_WORKFLOWS[workflow as LeadWorkflow];
  const sector = pick(sp.sector, Object.keys(LEAD_SECTORS) as LeadSector[]) ?? ctx.sector;
  const isCapital = "instrument" in wf;
  const instrument = isCapital ? (pick(sp.instrument, Object.keys(LEAD_INSTRUMENTS) as LeadInstrument[]) ?? ctx.instrument) : null;
  const country = sp.country !== undefined ? sp.country || null : ctx.country;
  const organization = sp.organization !== undefined ? sp.organization || null : workflow === "sponsor" ? ctx.organization : null;
  const query = buildLeadQuery({ workflow, sector, instrument, country, organization });
  const suggestions = await leadSuggestions(db, user.scope, type, ctx.id);
  const here = `/prospecting/find?type=${type}&id=${ctx.id}&workflow=${workflow}${sector ? `&sector=${sector}` : ""}${instrument ? `&instrument=${instrument}` : ""}${country ? `&country=${encodeURIComponent(country)}` : ""}${organization ? `&organization=${encodeURIComponent(organization)}` : ""}`;

  return (
    <>
      <PageHeader title="Find contacts" actions={<Link className="btn" href={ctx.href}>Back to {TYPE_LABEL[type].toLowerCase()}</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.sub}>{type === "general" ? "Search by who you need: project sponsors, equity, lenders, bond issuers, arrangers and reviewers, blended finance, grants, consortium partners, offtakers, EPC, energy operators, land and agriculture, public owners." : <>For {TYPE_LABEL[type].toLowerCase()} <Link href={ctx.href}>{ctx.title}</Link>.</>} Suggestions are only suggestions: nobody is contacted until you save a person, enrich them and approve a message. Community and Indigenous bodies are never searched.</p>

      <form method="get" action="/prospecting/find" className={styles.findForm}>
        <input type="hidden" name="type" value={type} /><input type="hidden" name="id" value={ctx.id} />
        <label>Who you need<select name="workflow" defaultValue={workflow}>{ctx.workflows.map(w => <option key={w} value={w}>{LEAD_WORKFLOWS[w].label}</option>)}</select></label>
        <label>Sector<select name="sector" defaultValue={sector ?? ""}><option value="">Any sector</option>{Object.entries(LEAD_SECTORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        {isCapital && <label>Instrument<select name="instrument" defaultValue={instrument ?? ""}>{Object.entries(LEAD_INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>}
        <label>Country<input name="country" defaultValue={country ?? ""} placeholder="e.g. Mexico" /></label>
        <label>Organisation (optional)<input name="organization" defaultValue={organization ?? ""} placeholder="A specific organisation" /></label>
        <button className="btn" type="submit">Update searches</button>
      </form>

      <section className={r.panel}>
        <p className={r.panelTitle}>{query.label}</p>
        <p className={ui.sub}>{query.why}</p>
        <form action={findPeopleAction} className={styles.findRun}>
          <input type="hidden" name="type" value={type} /><input type="hidden" name="id" value={ctx.id} /><input type="hidden" name="workflow" value={workflow} />
          <input type="hidden" name="sector" value={sector ?? ""} /><input type="hidden" name="instrument" value={instrument ?? ""} />
          <input type="hidden" name="country" value={country ?? ""} /><input type="hidden" name="organization" value={organization ?? ""} />
          <button className="btn btn--primary" type="submit">{apolloConfig() ? "Find people now (Apollo, no credits)" : "Save this search"}</button>
          <span className={ui.sub}>Or search yourself: <a href={query.links.linkedinPeople} target="_blank" rel="noreferrer">LinkedIn people</a> · <a href={query.links.salesNavigator} target="_blank" rel="noreferrer">Sales Navigator</a> · <a href={query.links.googlePeople} target="_blank" rel="noreferrer">Google</a> · <a href={query.links.linkedinCompanies} target="_blank" rel="noreferrer">LinkedIn companies</a></span>
        </form>
        <p className={styles.findLabel}>People search</p>
        <div className={styles.code}>{query.peopleBoolean}</div>
        <CopyButton text={query.peopleBoolean} />
        <p className={styles.findLabel}>Organisation search</p>
        <div className={styles.code}>{query.companyBoolean}</div>
        <CopyButton text={query.companyBoolean} />
      </section>

      <section className={r.panel}>
        <p className={r.panelTitle}><span>Suggested people for this {TYPE_LABEL[type].toLowerCase()}</span><span className={ui.sub}>{suggestions.length} to review</span></p>
        {suggestions.length === 0 ? <p className={r.empty}>No suggestions yet. Run a search above.</p> : (
          <form>
            <input type="hidden" name="back" value={here} />
            <ul className={styles.findList}>
              {suggestions.map(({ r: s, search }) => (
                <li key={s.id}>
                  <label><input type="checkbox" name="ids" value={s.id} defaultChecked /> <b>{s.name}</b></label>
                  <span className={ui.sub}>{s.subtitle ?? ""}{search ? ` · from "${search}"` : ""}</span>
                </li>
              ))}
            </ul>
            <div className={styles.findRun}>
              <button className="btn btn--primary" type="submit" formAction={saveResultsAction}>Save selected to Network</button>
              <button className="btn" type="submit" formAction={dismissResultsAction}>Dismiss selected</button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}

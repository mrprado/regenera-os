import Link from "next/link";
import { Building2, Search } from "lucide-react";
import { Notice, Pager, withParams } from "@/components/crm-bits";
import FilterForm from "@/components/filter-form";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { apolloConfig } from "@/lib/config";
import { listLists, listOrganizations, listSegments } from "@/lib/crm/queries";
import { appDb } from "@/lib/db/scoped";
import { creditsUsedThisMonth, searchOrganizations } from "@/lib/sources/apollo";
import { SourceError } from "@/lib/sources/http";
import { SECTORS } from "@/lib/vocab";
import { addToList, bulkPublicEnrich, bulkResearch, saveApolloCompanies } from "../crm-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Companies" };

type SP = Record<string, string | undefined>;
const split = (s?: string) => (s ?? "").split(",").map(x => x.trim()).filter(Boolean);

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/companies");
  const sp = await searchParams;
  const tab = sp.tab === "apollo" ? "apollo" : "saved";
  const [segs, orgLists, data] = await Promise.all([
    listSegments(), listLists(user.scope, "companies"),
    listOrganizations(user.scope, { q: sp.q, sector: sp.sector, country: sp.country, segment: sp.segment, source: sp.source, trigger: sp.trigger, list: sp.list, sort: sp.sort, page: Number(sp.page) || 1 }),
  ]);
  return (
    <>
      <PageHeader title="Companies" count={data.total} actions={<Link className="btn" href="/companies/new">Add company</Link>} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Company views">
        <Link className={`${ui.tab} ${tab === "saved" ? ui.tabActive : ""}`} href="/companies">Saved<span className={ui.tabCount}>{data.total}</span></Link>
        <Link className={`${ui.tab} ${tab === "apollo" ? ui.tabActive : ""}`} href="/companies?tab=apollo">Find in Apollo</Link>
      </nav>
      {tab === "saved" ? <SavedTab sp={sp} data={data} segs={segs} orgLists={orgLists} /> : <ApolloTab sp={sp} />}
    </>
  );
}

function SavedTab({ sp, data, segs, orgLists }: { sp: SP; data: Awaited<ReturnType<typeof listOrganizations>>; segs: Awaited<ReturnType<typeof listSegments>>; orgLists: Awaited<ReturnType<typeof listLists>> }) {
  const back = withParams("/companies", sp, { notice: undefined });
  return (
    <div className={ui.workspace}>
      <FilterForm action="/companies" className={ui.filters}>
        <p className={ui.filtersTitle}>Filters</p>
        <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name, domain, location" /></div>
        <div className={ui.field}><label htmlFor="sector">Sector</label>
          <select id="sector" name="sector" defaultValue={sp.sector ?? ""}><option value="">All sectors</option>{Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="country">Country or place</label><input id="country" name="country" defaultValue={sp.country} placeholder="e.g. Mexico" /></div>
        <div className={ui.field}><label htmlFor="segment">Segment</label>
          <select id="segment" name="segment" defaultValue={sp.segment ?? ""}><option value="">All segments</option>{segs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="trigger">Current trigger</label>
          <select id="trigger" name="trigger" defaultValue={sp.trigger ?? ""}><option value="">Any</option><option value="yes">Has a trigger this year</option></select></div>
        <div className={ui.field}><label htmlFor="list">List</label>
          <select id="list" name="list" defaultValue={sp.list ?? ""}><option value="">Any list</option>{orgLists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}</select></div>
        <div className={ui.field}><label htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={sp.sort ?? ""}><option value="">Most triggers</option><option value="recent">Recently added</option><option value="name">Name</option></select></div>
        <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/companies">Clear</Link></div>
      </FilterForm>
      <div>
        {data.rows.length === 0 ? (
          <EmptyState icon={Building2} title="No companies yet" body="Companies arrive from triggers, Apollo, site inquiries and imports. Each one is enriched from free public sources (Wikidata, GLEIF, SEC) and placed on the Map." actions={<Link className="btn btn--primary" href="/companies/new">Add company</Link>} />
        ) : (
          <form>
            <input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="companies" />
            <div className={ui.toolbar}>
              <span className={ui.resultCount}>{data.total} companies</span>
              <div className={ui.rowActions}>
                <select name="listId" aria-label="Add to list" defaultValue="" style={{ height: 28, borderRadius: 999, border: "1px solid var(--line)", fontSize: 12, padding: "0 10px" }}>
                  <option value="">Add to list…</option>{orgLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <input name="newList" placeholder="or new list name" aria-label="New list name" style={{ height: 28, borderRadius: 999, border: "1px solid var(--line)", fontSize: 12, padding: "0 10px" }} />
                <button className={ui.miniBtn} formAction={addToList} type="submit">Add to list</button>
                <button className={ui.miniBtn} formAction={bulkPublicEnrich} type="submit">Enrich from public sources (free)</button>
                <button className={ui.miniBtn} formAction={bulkResearch} type="submit">Research</button>
              </div>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th style={{ width: 28 }} /><th>Company</th><th>Sector</th><th>Location</th><th className={ui.num}>Triggers</th><th className={ui.num}>People</th><th className={ui.num}>Open deals</th><th>Identity</th></tr></thead>
                <tbody>
                  {data.rows.map(o => (
                    <tr key={o.id}>
                      <td><input type="checkbox" name="ids" value={o.id} aria-label={`Select ${o.name}`} /></td>
                      <td><Link className={ui.primary} href={`/companies/${o.id}`}>{o.name}</Link><span className={ui.sub}>{o.domain ?? o.industry ?? ""}</span></td>
                      <td>{o.sector ? SECTORS[o.sector as keyof typeof SECTORS] : o.industry ?? "—"}</td>
                      <td>{o.location ?? o.country ?? "—"}{o.lat != null && <span className={ui.sub}>on the map</span>}</td>
                      <td className={ui.num}>{o.triggers > 0 ? <span className={`${ui.chip} ${ui.chipEmber}`}>{o.triggers}</span> : 0}</td>
                      <td className={ui.num}>{o.people}</td>
                      <td className={ui.num}>{o.openDeals}</td>
                      <td>{[o.lei && "LEI", o.wikidataId && "Wikidata"].filter(Boolean).join(" · ") || <span className={ui.chipMuted}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} href={p => withParams("/companies", sp, { page: String(p), notice: undefined })} />
          </form>
        )}
      </div>
    </div>
  );
}

async function ApolloTab({ sp }: { sp: SP }) {
  const cfg = apolloConfig();
  const db = appDb();
  const used = cfg ? await creditsUsedThisMonth(db) : 0;
  let results: Awaited<ReturnType<typeof searchOrganizations>> | null = null;
  let error: string | null = null;
  const params = { q_organization_name: sp.name || undefined, organization_locations: split(sp.locations), q_organization_keyword_tags: split(sp.keywords), page: Number(sp.page) || 1 };
  if (cfg && sp.run === "1" && (params.q_organization_name || params.organization_locations.length || params.q_organization_keyword_tags.length)) {
    try { results = await searchOrganizations(db, cfg, params); }
    catch (e) { error = e instanceof SourceError ? e.message : "Apollo search failed."; }
  }
  const orgs = results ? [...(results.organizations ?? []), ...(results.accounts ?? [])] : [];
  const back = withParams("/companies", sp, { notice: undefined });
  return (
    <div className={ui.workspace}>
      <FilterForm action="/companies" className={ui.filters}>
        <input type="hidden" name="tab" value="apollo" />
        <p className={ui.filtersTitle}>Apollo company search</p>
        <div className={ui.field}><label htmlFor="name">Name contains</label><input id="name" name="name" defaultValue={sp.name} /></div>
        <div className={ui.field}><label htmlFor="locations">HQ locations</label><input id="locations" name="locations" defaultValue={sp.locations} placeholder="mexico, peru" /></div>
        <div className={ui.field}><label htmlFor="keywords">Keywords</label><input id="keywords" name="keywords" defaultValue={sp.keywords} placeholder="renewable energy, desalination" /></div>
        <div className={ui.filterActions}><button className="btn btn--primary" type="submit" name="run" value="1">Search (1 credit per page)</button></div>
        {cfg && <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0 0" }}>Credits used this month: {used} of {cfg.monthlyCreditBudget}. Pages return up to 100 companies and are cached for a day.</p>}
      </FilterForm>
      <div>
        {!cfg ? (
          <EmptyState icon={Search} title="Connect Apollo (free plan)" body="Set APOLLO_API_KEY from a free work-email Apollo account (docs/ENV.md). Company search costs 1 credit per page of up to 100; people search is free." />
        ) : error ? <p className={ui.notice}>{error}</p> : !results ? (
          <EmptyState icon={Search} title="Search Apollo's company database" body="Companies you save here are enriched from Wikidata, GLEIF and SEC for free and placed on the Map." />
        ) : (
          <form action={saveApolloCompanies}>
            <input type="hidden" name="back" value={back} />
            <div className={ui.toolbar}><span className={ui.resultCount}>{results.pagination?.total_entries ?? orgs.length} matches · page {params.page}</span>
              <button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Save selected</button></div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th style={{ width: 28 }} /><th>Company</th><th>Industry</th><th>Location</th><th className={ui.num}>Staff</th></tr></thead>
                <tbody>
                  {orgs.map((o, i) => (
                    <tr key={o.id ?? i}>
                      <td><input type="checkbox" name="pick" value={JSON.stringify({ id: o.id, name: o.name, domain: o.primary_domain, website: o.website_url, industry: o.industry, headcount: o.estimated_num_employees, city: o.city, country: o.country, linkedin_url: o.linkedin_url, founded: o.founded_year, description: o.short_description })} aria-label={`Select ${o.name}`} /></td>
                      <td><span className={ui.primary}>{o.name}</span><span className={ui.sub}>{o.primary_domain ?? ""}</span></td>
                      <td>{o.industry ?? "—"}</td>
                      <td>{[o.city, o.country].filter(Boolean).join(", ") || "—"}</td>
                      <td className={ui.num}>{o.estimated_num_employees ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={params.page} pageSize={100} total={Math.min(results.pagination?.total_entries ?? 0, 50000)} href={p => withParams("/companies", sp, { page: String(p), run: "1", notice: undefined })} />
          </form>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { Search, Users } from "lucide-react";
import { EmailChip, Notice, Pager, ScoreChip, withParams } from "@/components/crm-bits";
import FilterForm from "@/components/filter-form";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { apolloConfig } from "@/lib/config";
import { listContacts, listLists, listSegments } from "@/lib/crm/queries";
import { appDb } from "@/lib/db/scoped";
import { APOLLO_FREE_LIMITS, searchPeople, type PeopleSearchParams } from "@/lib/sources/apollo";
import { SourceError } from "@/lib/sources/http";
import { APOLLO_SENIORITIES, EMAIL_STATUSES, TIERS } from "@/lib/vocab";
import { addToList, bulkEnrichPeople, bulkResearch, saveApolloPeople } from "../crm-actions";
import { enrollAction } from "../outreach-actions";
import { activeSequencesForPicker } from "@/lib/outreach/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

type SP = Record<string, string | undefined>;
const split = (s?: string) => (s ?? "").split(",").map(x => x.trim()).filter(Boolean);

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/people");
  const sp = await searchParams;
  const tab = sp.tab === "apollo" ? "apollo" : "saved";
  const [segs, peopleLists, saved, sequencesForPicker] = await Promise.all([
    listSegments(), listLists(user.scope, "people"),
    listContacts(user.scope, { q: sp.q, title: sp.title, seniority: sp.seniority, emailStatus: sp.email, tier: sp.tier, segment: sp.segment, source: sp.source, list: sp.list, org: sp.org, sort: sp.sort, page: Number(sp.page) || 1 }),
    activeSequencesForPicker(user.scope),
  ]);
  return (
    <>
      <PageHeader title="People" count={saved.total} actions={<><Link className="btn" href="/people/import">Import CSV</Link><Link className="btn" href="/people/new">Add person</Link></>} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="People views">
        <Link className={`${ui.tab} ${tab === "saved" ? ui.tabActive : ""}`} href="/people">Saved<span className={ui.tabCount}>{saved.total}</span></Link>
        <Link className={`${ui.tab} ${tab === "apollo" ? ui.tabActive : ""}`} href="/people?tab=apollo">Find in Apollo</Link>
      </nav>
      {tab === "saved"
        ? <SavedTab sp={sp} data={saved} segs={segs} peopleLists={peopleLists} sequencesForPicker={sequencesForPicker} />
        : <ApolloTab sp={sp} segs={segs} />}
    </>
  );
}

function SavedTab({ sp, data, segs, peopleLists, sequencesForPicker }: { sp: SP; data: Awaited<ReturnType<typeof listContacts>>; segs: Awaited<ReturnType<typeof listSegments>>; peopleLists: Awaited<ReturnType<typeof listLists>>; sequencesForPicker: Awaited<ReturnType<typeof activeSequencesForPicker>> }) {
  const back = withParams("/people", sp, { notice: undefined });
  return (
    <div className={ui.workspace}>
      <FilterForm action="/people" className={ui.filters}>
        <p className={ui.filtersTitle}>Filters</p>
        <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name, email, organization" /></div>
        <div className={ui.field}><label htmlFor="title">Title contains</label><input id="title" name="title" defaultValue={sp.title} placeholder="e.g. investment" /></div>
        <div className={ui.field}><label htmlFor="segment">Segment</label>
          <select id="segment" name="segment" defaultValue={sp.segment ?? ""}><option value="">All segments</option>{segs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="tier">Tier</label>
          <select id="tier" name="tier" defaultValue={sp.tier ?? ""}><option value="">Any tier</option>{TIERS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="email">Email status</label>
          <select id="email" name="email" defaultValue={sp.email ?? ""}><option value="">Any</option>{EMAIL_STATUSES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="list">List</label>
          <select id="list" name="list" defaultValue={sp.list ?? ""}><option value="">Any list</option>{peopleLists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}</select></div>
        <div className={ui.field}><label htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={sp.sort ?? ""}><option value="">Score</option><option value="recent">Recently added</option><option value="name">Name</option></select></div>
        <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/people">Clear</Link></div>
      </FilterForm>
      <div>
        {data.rows.length === 0 ? (
          <EmptyState icon={Users} title="No people yet" body="Find people in Apollo (free search), add someone manually, or import a CSV. Saved people get identity enrichment from free public sources, then research and a score." actions={<Link className="btn btn--primary" href="/people?tab=apollo">Find in Apollo</Link>} />
        ) : (
          <form>
            <input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value="people" />
            <div className={ui.toolbar}>
              <span className={ui.resultCount}>{data.total} people</span>
              <div className={ui.rowActions}>
                <select name="listId" aria-label="Add to list" defaultValue="" style={{ height: 28, borderRadius: 999, border: "1px solid var(--line)", fontSize: 12, padding: "0 10px" }}>
                  <option value="">Add to list…</option>{peopleLists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <input name="newList" placeholder="or new list name" aria-label="New list name" style={{ height: 28, borderRadius: 999, border: "1px solid var(--line)", fontSize: 12, padding: "0 10px" }} />
                <button className={ui.miniBtn} formAction={addToList} type="submit">Add to list</button>
                <button className={ui.miniBtn} formAction={bulkResearch} type="submit">Research</button>
                <button className={ui.miniBtn} formAction={bulkEnrichPeople} type="submit">Enrich email (Apollo, 1 credit each)</button>
                <select name="sequenceId" aria-label="Sequence" defaultValue="" style={{ height: 28, borderRadius: 999, border: "1px solid var(--line)", fontSize: 12, padding: "0 10px" }}>
                  <option value="">Sequence…</option>{sequencesForPicker.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
                <button className={`${ui.miniBtn} ${ui.miniPrimary}`} formAction={enrollAction} type="submit">Enroll</button>
              </div>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th style={{ width: 28 }}><span className="sr-only">Select</span></th><th>Name</th><th>Organization</th><th>Email</th><th>Score</th><th>Stage</th><th>Source</th></tr></thead>
                <tbody>
                  {data.rows.map(p => (
                    <tr key={p.id}>
                      <td><input type="checkbox" name="ids" value={p.id} aria-label={`Select ${p.fullName}`} /></td>
                      <td><Link className={ui.primary} href={`/people/${p.id}`}>{p.fullName}</Link><span className={ui.sub}>{p.title ?? ""}</span></td>
                      <td>{p.orgId ? <Link href={`/companies/${p.orgId}`}>{p.orgName}</Link> : "—"}<span className={ui.sub}>{p.location ?? ""}</span></td>
                      <td>{p.email ? <span className={ui.sub} style={{ marginTop: 0 }}>{p.email}</span> : null}<EmailChip status={p.emailStatus} /></td>
                      <td><ScoreChip score={p.score} tier={p.tier} /></td>
                      <td>{p.leadState}</td>
                      <td><span className={ui.chip}>{p.source}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} href={p => withParams("/people", sp, { page: String(p), notice: undefined })} />
          </form>
        )}
      </div>
    </div>
  );
}

async function ApolloTab({ sp, segs }: { sp: SP; segs: Awaited<ReturnType<typeof listSegments>> }) {
  const cfg = apolloConfig();
  const seg = sp.segment ? segs.find(s => s.id === sp.segment) : undefined;
  const segFilters = (seg?.apolloFilters ?? {}) as PeopleSearchParams;
  const params: PeopleSearchParams = {
    person_titles: split(sp.titles).length ? split(sp.titles) : segFilters.person_titles,
    person_seniorities: split(sp.seniorities).length ? split(sp.seniorities) : segFilters.person_seniorities,
    person_locations: split(sp.locations),
    organization_locations: split(sp.orgLocations).length ? split(sp.orgLocations) : segFilters.organization_locations,
    q_organization_domains_list: split(sp.domains),
    q_keywords: sp.keywords || segFilters.q_keywords,
    page: Number(sp.page) || 1,
    per_page: 25,
  };
  const hasQuery = !!(params.person_titles?.length || params.q_keywords || params.person_locations?.length || params.q_organization_domains_list?.length || params.organization_locations?.length);

  let results: Awaited<ReturnType<typeof searchPeople>> | null = null;
  let error: string | null = null;
  if (cfg && hasQuery && sp.run === "1") {
    try { results = await searchPeople(appDb(), cfg, params); }
    catch (e) { error = e instanceof SourceError ? e.message : "Apollo search failed."; }
  }
  const back = withParams("/people", sp, { notice: undefined });

  return (
    <div className={ui.workspace}>
      <FilterForm action="/people" className={ui.filters}>
        <input type="hidden" name="tab" value="apollo" /><input type="hidden" name="run" value="1" />
        <p className={ui.filtersTitle}>Apollo search (free)</p>
        <div className={ui.field}><label htmlFor="segment">Start from a segment</label>
          <select id="segment" name="segment" defaultValue={sp.segment ?? ""}><option value="">None</option>{segs.filter(s => s.enabled).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="titles">Titles (comma separated)</label><input id="titles" name="titles" defaultValue={sp.titles ?? segFilters.person_titles?.join(", ")} /></div>
        <div className={ui.field}><label htmlFor="seniorities">Seniorities</label><input id="seniorities" name="seniorities" defaultValue={sp.seniorities ?? segFilters.person_seniorities?.join(", ")} placeholder={APOLLO_SENIORITIES.slice(0, 5).join(", ")} /></div>
        <div className={ui.field}><label htmlFor="locations">Person locations</label><input id="locations" name="locations" defaultValue={sp.locations} placeholder="mexico, chile, texas" /></div>
        <div className={ui.field}><label htmlFor="orgLocations">Company HQ locations</label><input id="orgLocations" name="orgLocations" defaultValue={sp.orgLocations ?? segFilters.organization_locations?.join(", ")} /></div>
        <div className={ui.field}><label htmlFor="domains">Company domains</label><input id="domains" name="domains" defaultValue={sp.domains} placeholder="brookfield.com" /></div>
        <div className={ui.field}><label htmlFor="keywords">Keywords</label><input id="keywords" name="keywords" defaultValue={sp.keywords ?? segFilters.q_keywords} /></div>
        <div className={ui.filterActions}><button className="btn btn--primary" type="submit">Search</button><Link className={ui.clear} href="/people?tab=apollo">Clear</Link></div>
        <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0 0" }}>Search uses 0 credits. Free plan: {APOLLO_FREE_LIMITS.search.perMinute}/min, {APOLLO_FREE_LIMITS.search.perHour}/hour, {APOLLO_FREE_LIMITS.search.perDay}/day. Emails come from enrichment (1 credit each, only when found).</p>
      </FilterForm>
      <div>
        {!cfg ? (
          <EmptyState icon={Search} title="Connect Apollo (free plan)" body="Create a free Apollo account with your work email, create an API key, and set APOLLO_API_KEY (docs/ENV.md). Search is free; the OS enforces the free plan's limits and your monthly credit budget." />
        ) : error ? (
          <p className={ui.notice}>{error}</p>
        ) : !results ? (
          <EmptyState icon={Search} title="Search Apollo's people database" body="Pick a segment to prefill Regenera's titles and keywords, or enter your own filters. Results are not saved until you select them." />
        ) : results.people.length === 0 ? (
          <EmptyState icon={Search} title="No matches" body="Loosen the titles or locations and search again." />
        ) : (
          <form action={saveApolloPeople}>
            <input type="hidden" name="back" value={back} />{seg && <input type="hidden" name="segment" value={seg.id} />}
            <div className={ui.toolbar}>
              <span className={ui.resultCount}>{results.pagination?.total_entries ?? results.total_entries ?? results.people.length} matches in Apollo · page {params.page}</span>
              <div className={ui.rowActions}>
                <button className={ui.miniBtn} type="submit" name="enrich" value="0">Save selected</button>
                <button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit" name="enrich" value="1">Save and find emails</button>
              </div>
            </div>
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th style={{ width: 28 }} /><th>Name</th><th>Title</th><th>Organization</th><th>Location</th></tr></thead>
                <tbody>
                  {results.people.map(p => {
                    const pick = JSON.stringify({
                      id: p.id, first_name: p.first_name, last_name: p.last_name, name: p.name, title: p.title, seniority: p.seniority, linkedin_url: p.linkedin_url,
                      city: p.city, state: p.state, country: p.country,
                      org: p.organization ? { id: p.organization.id, name: p.organization.name, domain: p.organization.primary_domain, website: p.organization.website_url, industry: p.organization.industry, headcount: p.organization.estimated_num_employees, city: p.organization.city, country: p.organization.country, linkedin_url: p.organization.linkedin_url } : null,
                    });
                    const name = p.name || [p.first_name, p.last_name ?? p.last_name_obfuscated].filter(Boolean).join(" ");
                    return (
                      <tr key={p.id}>
                        <td><input type="checkbox" name="pick" value={pick} aria-label={`Select ${name}`} /></td>
                        <td><span className={ui.primary}>{name}</span>{p.linkedin_url && <span className={ui.sub}><a href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></span>}</td>
                        <td>{p.title}<span className={ui.sub}>{p.seniority ?? ""}</span></td>
                        <td>{p.organization?.name ?? "—"}<span className={ui.sub}>{[p.organization?.industry, p.organization?.estimated_num_employees ? `${p.organization.estimated_num_employees} staff` : ""].filter(Boolean).join(" · ")}</span></td>
                        <td>{[p.city, p.country].filter(Boolean).join(", ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={params.page ?? 1} pageSize={25} total={Math.min(results.pagination?.total_entries ?? 0, 50000)} href={p => withParams("/people", sp, { page: String(p), notice: undefined })} />
          </form>
        )}
      </div>
    </div>
  );
}

import Link from "next/link";
import { Telescope } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { apolloConfig } from "@/lib/config";
import { isOwner } from "@/lib/db/scoped";
import { listOverview, savedSearchList, searchResultsFor } from "@/lib/radar/queries";
import { linkFor } from "@/lib/radar/saved-searches";
import { runListNowAction, runSearchNowAction, saveResultsAction, scanNowAction, toggleSearchAction } from "../radar-actions";
import PlaybooksTab from "./playbooks-tab";
import CopyButton from "./copy-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prospecting" };

type SP = Record<string, string | undefined>;

export default async function ProspectingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/prospecting");
  const sp = await searchParams;
  const tab = sp.tab === "links" || sp.tab === "lists" || sp.tab === "people" ? (sp.tab === "people" ? "apollo" : sp.tab) : sp.search ? "apollo" : "playbooks";
  const all = await savedSearchList(user.scope);
  const apollo = all.filter(x => x.s.kind === "apollo_people");
  const links = all.filter(x => x.s.kind === "xray" || x.s.kind === "salesnav");
  const newTotal = apollo.reduce((a, x) => a + x.newCount, 0);
  const owner = isOwner(user.scope);

  return (
    <>
      <PageHeader title="Prospecting" count={newTotal || undefined} actions={owner ? <form action={scanNowAction}><button className="btn btn--primary" type="submit">Scan now</button></form> : undefined} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Prospecting views">
        <Link className={`${ui.tab} ${tab === "playbooks" ? ui.tabActive : ""}`} href="/prospecting">Playbooks</Link>
        <Link className={`${ui.tab} ${tab === "apollo" ? ui.tabActive : ""}`} href="/prospecting?tab=people">New people<span className={ui.tabCount}>{newTotal}</span></Link>
        <Link className={`${ui.tab} ${tab === "links" ? ui.tabActive : ""}`} href="/prospecting?tab=links">LinkedIn and Google<span className={ui.tabCount}>{links.length}</span></Link>
        <Link className={`${ui.tab} ${tab === "lists" ? ui.tabActive : ""}`} href="/prospecting?tab=lists">Public lists</Link>
      </nav>
      {tab === "playbooks" && <PlaybooksTab region={sp.region} scope={user.scope} />}
      {tab === "apollo" && <ApolloTab rows={apollo} sp={sp} owner={owner} scope={user.scope} />}
      {tab === "links" && <LinksTab rows={links} />}
      {tab === "lists" && <ListsTab owner={owner} />}
    </>
  );
}

async function ApolloTab({ rows, sp, owner, scope }: { rows: Awaited<ReturnType<typeof savedSearchList>>; sp: SP; owner: boolean; scope: Parameters<typeof searchResultsFor>[0] }) {
  const results = await searchResultsFor(scope, sp.search);
  const back = `/prospecting?tab=people${sp.search ? `&search=${sp.search}` : ""}`;
  return (
    <>
      {!apolloConfig() && <p className={ui.notice}>Set <code>APOLLO_API_KEY</code> (free plan). People search costs no credits. Each segment&apos;s search runs weekly and shows only people not already in the CRM.</p>}
      <div className={ui.workspace}>
        <aside className={ui.filters}>
          <p className={ui.filtersTitle}>Searches</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 13 }}>
            <li style={{ marginBottom: 8 }}><Link href="/prospecting?tab=people" style={{ fontWeight: sp.search ? 400 : 700 }}>All new results</Link></li>
            {rows.map(({ s, newCount }) => (
              <li key={s.id} style={{ marginBottom: 10, opacity: s.enabled ? 1 : 0.55 }}>
                <Link href={`/prospecting?tab=people&search=${s.id}`} style={{ fontWeight: sp.search === s.id ? 700 : 400 }}>{s.name.replace(/: new people$/, "")}</Link>
                {newCount > 0 && <span className={ui.chip} style={{ marginLeft: 6 }}>{newCount}</span>}
                <span className={ui.sub}>{s.enabled ? `Runs ${s.cadence.replace(/^weekly:(\w+):(\d\d:\d\d)$/, "weekly, $1 $2 ET")}` : "Paused"}{s.lastRunAt ? ` · last ${s.lastRunAt.slice(0, 10)}` : " · not run yet"}</span>
                <div className={ui.rowActions} style={{ marginTop: 4 }}>
                  <form action={runSearchNowAction}><input type="hidden" name="id" value={s.id} /><button className={ui.miniBtn} type="submit">Run now</button></form>
                  {owner && <form action={toggleSearchAction}><input type="hidden" name="id" value={s.id} /><button className={ui.miniBtn} type="submit">{s.enabled ? "Pause" : "Resume"}</button></form>}
                </div>
              </li>
            ))}
          </ul>
        </aside>
        <div>
          {results.length === 0 ? (
            <EmptyState icon={Telescope} title="No new results" body="New people from saved searches appear here for review. Save them to People (no credits), or dismiss them so they never come back." />
          ) : (
            <form>
              <input type="hidden" name="back" value={back} />
              <div className={ui.toolbar}>
                <span className={ui.resultCount}>{results.length} new</span>
                <div className={ui.rowActions}>
                  <button className={`${ui.miniBtn} ${ui.miniPrimary}`} formAction={saveResultsAction} name="do" value="save" type="submit">Save to People</button>
                  <button className={ui.miniBtn} formAction={saveResultsAction} name="do" value="dismiss" type="submit">Dismiss</button>
                </div>
              </div>
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead><tr><th style={{ width: 28 }}><span className="sr-only">Select</span></th><th>Person</th><th>Found by</th><th>Found</th></tr></thead>
                  <tbody>
                    {results.map(({ r, searchName }) => (
                      <tr key={r.id}>
                        <td><input type="checkbox" name="ids" value={r.id} aria-label={`Select ${r.name}`} /></td>
                        <td><span className={ui.primary}>{r.name}</span><span className={ui.sub}>{r.subtitle ?? ""}</span></td>
                        <td>{searchName.replace(/: new people$/, "")}</td>
                        <td>{r.foundAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function LinksTab({ rows }: { rows: Awaited<ReturnType<typeof savedSearchList>> }) {
  return (
    <>
      <p className={ui.notice}>These open in your own browser. Google has no free search API for new customers and LinkedIn is never scraped, so the OS stores the queries and you run them. Save anyone useful with the extension or Add person.</p>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>Search</th><th>Where</th><th>Query</th><th /></tr></thead>
          <tbody>
            {rows.map(({ s }) => (
              <tr key={s.id}>
                <td className={ui.primary}>{s.name}</td>
                <td>{s.kind === "xray" ? "Google" : "Sales Navigator"}</td>
                <td className={ui.wrap}><code style={{ fontSize: 12 }}>{s.query}</code></td>
                <td><div className={ui.rowActions}>
                  <a className={`${ui.miniBtn} ${ui.miniPrimary}`} style={{ display: "inline-flex", alignItems: "center" }} href={linkFor(s.kind, s.query ?? "")} target="_blank" rel="noreferrer">Open</a>
                  <CopyButton text={s.query ?? ""} />
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function ListsTab({ owner }: { owner: boolean }) {
  const { sources, recent, tracked } = await listOverview();
  return (
    <>
      <p className={ui.notice}>Monthly, on the 2nd. Only public files and tables are used (SBTi companies file, TNFD adopters table). The first run records a baseline, and only entries updated in the last 60 days count as new. After that, anything not seen before is new. In-scope new entries become organizations with free identity enrichment.</p>
      <div className={ui.tableWrap} style={{ marginBottom: 20 }}>
        <table className={ui.table}>
          <thead><tr><th>List</th><th className={ui.num}>Entries</th><th className={ui.num}>In scope, tracked</th><th className={ui.num}>New last run</th><th>Last run</th><th /></tr></thead>
          <tbody>
            {sources.map(s => (
              <tr key={s.key}>
                <td><a className={ui.primary} href={s.url} target="_blank" rel="noreferrer">{s.name}</a>{s.lastError && <span className={ui.sub} style={{ color: "#b0432f" }}>{s.lastError}</span>}</td>
                <td className={ui.num}>{s.lastCount ?? "—"}</td>
                <td className={ui.num}>{tracked[s.key] ?? 0}</td>
                <td className={ui.num}>{s.lastNew ?? "—"}</td>
                <td>{s.lastRunAt ? s.lastRunAt.slice(0, 10) : "Not run yet"}{!s.baselineAt && s.lastRunAt ? " (failed)" : ""}</td>
                <td>{owner && <form action={runListNowAction}><input type="hidden" name="key" value={s.key} /><button className={ui.miniBtn} type="submit">Run now</button></form>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>New entries</h2>
      {recent.length === 0 ? <p style={{ fontSize: 13.5 }}>None yet.</p> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Organization</th><th>List</th><th>Sector</th><th>Country</th><th>Detail</th><th>Seen</th></tr></thead>
            <tbody>
              {recent.map(({ e, orgName }) => {
                const d = (e.detail ?? {}) as Record<string, string | null>;
                return (
                  <tr key={e.id}>
                    <td>{e.orgId ? <Link className={ui.primary} href={`/companies/${e.orgId}`}>{orgName ?? e.name}</Link> : e.name}</td>
                    <td>{e.sourceKey.toUpperCase()}</td>
                    <td className={ui.wrap}>{e.sector ?? "—"}</td>
                    <td>{e.country ?? "—"}</td>
                    <td className={ui.wrap}>{[d.type, d.near_term && `near-term: ${d.near_term}`, d.net_zero_year && `net zero ${d.net_zero_year}`, d.disclosure && `disclosure ${d.disclosure}`].filter(Boolean).join(" · ")}</td>
                    <td>{e.firstSeenAt.slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

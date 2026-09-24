import Link from "next/link";
import { HandCoins } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import FilterForm from "@/components/filter-form";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { caseRecords, deals } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { bidDeals, funderProfiles, libraryBlocks, listFunding } from "@/lib/funding/queries";
import { getState } from "@/lib/state";
import { amount, daysLabel, daysLeft, ROUTE_LABEL, SOURCE_LABEL } from "@/lib/funding/labels";
import { DEAL_STAGES } from "@/lib/vocab";
import { decideFundingAction, deleteLibraryAction, saveLibraryAction, scanFundingNowAction } from "../funding-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funding" };

type SP = Record<string, string | undefined>;


export default async function FundingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/funding");
  const sp = await searchParams;
  const tab = ["calendar", "bids", "funders", "library"].includes(sp.tab ?? "") ? sp.tab! : "open";
  const owner = isOwner(user.scope);
  const last = await getState(appDb(), "funding_scan_last").then(v => { try { return v ? JSON.parse(v) as { at: string; fresh: number; errors: string[] } : null; } catch { return null; } });
  return (
    <>
      <PageHeader title="Funding" actions={owner ? <form action={scanFundingNowAction}><button className="btn btn--primary" type="submit">Scan now</button></form> : undefined} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Funding views">
        {([["open", "Opportunities"], ["calendar", "Calendar"], ["bids", "Bids"], ["funders", "Funders"], ["library", "Bid library"]] as const).map(([k, v]) => (
          <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={k === "open" ? "/funding" : `/funding?tab=${k}`}>{v}</Link>
        ))}
      </nav>
      {tab === "open" && <OpenTab sp={sp} scope={user.scope} last={last} />}
      {tab === "calendar" && <CalendarTab scope={user.scope} />}
      {tab === "bids" && <BidsTab scope={user.scope} />}
      {tab === "funders" && <FundersTab scope={user.scope} />}
      {tab === "library" && <LibraryTab scope={user.scope} edit={sp.edit} />}
    </>
  );
}

async function OpenTab({ sp, scope, last }: { sp: SP; scope: Parameters<typeof listFunding>[0]; last: { at: string; fresh: number; errors: string[] } | null }) {
  const { rows, total, closingSoon } = await listFunding(scope, { q: sp.q, route: sp.route, type: sp.type, source: sp.source, region: sp.region, minFit: sp.min ? Number(sp.min) : undefined, window: sp.window, decision: sp.decision });
  const back = `/funding?${new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "notice") as [string, string][])}`;
  return (
    <>
      <p className={ui.notice}>
        Open and forthcoming grants, calls and tenders worldwide, with deadlines from today on. Sources: Grants.gov, the EU Funding &amp; Tenders Portal, EU TED, World Bank and UK Contracts Finder.
        {aiConfig() ? " Claude reads each one for fit and route." : " Ranked by keyword fit until ANTHROPIC_API_KEY is set, then Claude reads each for fit and route."}
        {last ? ` Last scan ${last.at.slice(0, 16).replace("T", " ")} UTC, ${last.fresh} new.` : " First scan runs on the next job tick."} {closingSoon} close in the next 14 days.
      </p>
      <div className={ui.workspace}>
        <FilterForm action="/funding" className={ui.filters}>
          <p className={ui.filtersTitle}>Filters</p>
          <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Title, funder, topic" /></div>
          <div className={ui.field}><label htmlFor="route">Route</label>
            <select id="route" name="route" defaultValue={sp.route ?? ""}><option value="">Any route</option>{Object.entries(ROUTE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="type">Type</label>
            <select id="type" name="type" defaultValue={sp.type ?? ""}><option value="">Any type</option>{["grant", "call", "tender", "prize", "concessional"].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="source">Source</label>
            <select id="source" name="source" defaultValue={sp.source ?? ""}><option value="">All sources</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className={ui.field}><label htmlFor="region">Country or region</label><input id="region" name="region" defaultValue={sp.region} placeholder="e.g. Peru, United Kingdom, European Union" /></div>
          <div className={ui.field}><label htmlFor="min">Minimum fit</label>
            <select id="min" name="min" defaultValue={sp.min ?? ""}><option value="">Any</option><option value="50">50+</option><option value="70">70+</option><option value="85">85+</option></select></div>
          <div className={ui.field}><label htmlFor="window">Closes within</label>
            <select id="window" name="window" defaultValue={sp.window ?? ""}><option value="">Any time</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">12 months</option></select></div>
          <div className={ui.field}><label htmlFor="decision">Status</label>
            <select id="decision" name="decision" defaultValue={sp.decision ?? ""}><option value="">Not dismissed</option><option value="new">New</option><option value="watching">Watching</option><option value="bidding">Bidding</option><option value="matched">Applicants found</option><option value="dismissed">Dismissed</option></select></div>
          <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/funding">Clear</Link></div>
        </FilterForm>
        <div>
          {rows.length === 0 ? (
            <EmptyState icon={HandCoins} title="No open opportunities yet" body="The funding scan runs every 2 hours across all sources, a few at a time. Use Scan now to start one." />
          ) : (
            <>
              <div className={ui.toolbar}><span className={ui.resultCount}>{total} open opportunities{total > rows.length ? `, showing the top ${rows.length}` : ""}</span></div>
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead><tr><th>Opportunity</th><th>Route</th><th>Amount</th><th>Deadline</th><th className={ui.num}>Fit</th><th /></tr></thead>
                  <tbody>
                    {rows.map(o => {
                      const d = daysLeft(o.deadline);
                      return (
                        <tr key={o.id}>
                          <td className={ui.wrap}><Link className={ui.primary} href={`/funding/${o.id}`}>{o.title}</Link>
                            <span className={ui.sub}>{[o.funder, SOURCE_LABEL[o.source], o.type, (o.countries ?? []).slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
                            {o.read?.summary && <span className={ui.sub}>{o.read.summary}</span>}</td>
                          <td>{o.route ? <span className={ui.chip}>{ROUTE_LABEL[o.route]}</span> : <span className={ui.chipMuted}>Not read yet</span>}{o.decision !== "new" && <span className={ui.sub}>{o.decision}</span>}</td>
                          <td>{amount(o.amountMin, o.amountMax, o.currency)}</td>
                          <td style={{ whiteSpace: "nowrap", color: d !== null && d <= 14 ? "#b0432f" : undefined }}>{o.deadline ?? "Rolling"}{d !== null && <span className={ui.sub}>{daysLabel(d)}</span>}</td>
                          <td className={ui.num}>{o.fit ?? "—"}{!o.readAt && o.fit !== null && <span className={ui.sub}>keywords</span>}</td>
                          <td><div className={ui.rowActions}>
                            {o.decision !== "watching" && o.decision !== "bidding" && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="watching" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Watch</button></form>}
                            {o.decision !== "dismissed" && o.decision !== "bidding" && <form action={decideFundingAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="dismissed" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Dismiss</button></form>}
                          </div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {last?.errors?.length ? <p className={ui.sub}>Last scan could not reach: {last.errors.slice(0, 3).join("; ")}</p> : null}
        </div>
      </div>
    </>
  );
}

async function CalendarTab({ scope }: { scope: Parameters<typeof listFunding>[0] }) {
  const { rows } = await listFunding(scope, { window: "365" });
  const byMonth = new Map<string, typeof rows>();
  for (const o of [...rows].sort((a, b) => (a.deadline ?? "9").localeCompare(b.deadline ?? "9"))) {
    const k = o.deadline?.slice(0, 7) ?? "Rolling";
    byMonth.set(k, [...(byMonth.get(k) ?? []), o]);
  }
  return byMonth.size === 0 ? <EmptyState icon={HandCoins} title="Nothing on the calendar" body="Deadlines for the next 12 months appear here once the scan has run." /> : (
    <>
      {[...byMonth.entries()].map(([month, list]) => (
        <section key={month} className={ui.tableWrap} style={{ marginBottom: 14 }}>
          <p className={ui.filtersTitle} style={{ padding: "12px 14px 0" }}>{month === "Rolling" ? "No fixed deadline" : new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
          <table className={ui.table}><tbody>{list.map(o => (
            <tr key={o.id}><td style={{ width: 100 }}>{o.deadline ?? "—"}</td><td className={ui.wrap}><Link href={`/funding/${o.id}`}>{o.title}</Link><span className={ui.sub}>{o.funder ?? ""}</span></td><td>{o.route ? ROUTE_LABEL[o.route] : ""}</td><td className={ui.num}>{o.fit ?? "—"}</td></tr>
          ))}</tbody></table>
        </section>
      ))}
    </>
  );
}

async function BidsTab({ scope }: { scope: Parameters<typeof bidDeals>[0] }) {
  const rows = await bidDeals(scope);
  const won = rows.filter(r => ["signed", "active", "expansion", "completed"].includes(r.d.stage)).length;
  const lost = rows.filter(r => r.d.stage === "lost").length;
  return (
    <>
      <div className={ui.stats}>
        <div className={ui.stat}><b>{rows.length}</b><span>Bids opened</span></div>
        <div className={ui.stat}><b>{won}</b><span>Won</span></div>
        <div className={ui.stat}><b>{won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "—"}</b><span>Win rate</span></div>
      </div>
      {rows.length === 0 ? <EmptyState icon={HandCoins} title="No bids yet" body="Open an opportunity and choose Bid. It becomes a deal with tasks planned back from the deadline." /> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Bid</th><th>Funder</th><th>Route</th><th>Deadline</th><th>Stage</th><th>Next action</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.d.id}>
                <td className={ui.wrap}><Link className={ui.primary} href={`/funding/${r.oppId}`}>{r.title}</Link></td>
                <td>{r.funder ?? "—"}</td><td>{r.route ? ROUTE_LABEL[r.route] : "—"}</td><td>{r.deadline ?? "—"}</td>
                <td><span className={ui.chip}>{DEAL_STAGES[r.d.stage as keyof typeof DEAL_STAGES]}</span></td>
                <td>{r.d.nextAction ?? "—"}<span className={ui.sub}>{r.d.nextActionDate ?? ""}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function FundersTab({ scope }: { scope: Parameters<typeof funderProfiles>[0] }) {
  const rows = await funderProfiles(scope);
  return rows.length === 0 ? <EmptyState icon={HandCoins} title="No funders yet" body="Funders appear as the scan finds their calls." /> : (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <thead><tr><th>Funder</th><th className={ui.num}>Open calls</th><th className={ui.num}>Seen</th><th>Largest award</th><th>Next deadline</th><th className={ui.num}>Bids</th><th>Sources</th></tr></thead>
        <tbody>{rows.map(f => (
          <tr key={f.funder}><td className={ui.primary}><Link href={`/funding?q=${encodeURIComponent(f.funder ?? "")}`}>{f.funder}</Link></td><td className={ui.num}>{f.open}</td><td className={ui.num}>{f.seen}</td>
            <td>{f.maxAmount ? `${Math.round(f.maxAmount).toLocaleString("en-US")} ${f.currency ?? ""}` : "—"}</td><td>{f.nextDeadline ?? "—"}</td><td className={ui.num}>{f.bids}</td>
            <td>{(f.sources ?? "").split(",").map(s => SOURCE_LABEL[s] ?? s).join(", ")}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

async function LibraryTab({ scope, edit }: { scope: Parameters<typeof libraryBlocks>[0]; edit?: string }) {
  const blocks = await libraryBlocks(scope);
  const cases = await appDb().select({ id: caseRecords.id, deal: deals.name, authorized: caseRecords.disclosureAuthorized }).from(caseRecords).innerJoin(deals, eq(deals.id, caseRecords.dealId))
    .where(mandateCondition(scope, caseRecords.mandateId)).orderBy(desc(caseRecords.updatedAt));
  const current = blocks.find(b => b.b.id === edit)?.b;
  const field = { width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", font: "inherit", fontSize: 13.5 } as const;
  return (
    <>
      <p className={ui.notice}>Reusable proposal blocks. Claude drafts first-pass proposal sections from these and the call text. Past performance is used only when its case record is marked disclosure authorized (Reports, Case evidence).</p>
      <form action={saveLibraryAction} className={ui.tableWrap} style={{ padding: 14, marginBottom: 16, display: "grid", gap: 8 }}>
        {current && <input type="hidden" name="id" value={current.id} />}
        <div style={{ display: "flex", gap: 8 }}>
          <select name="kind" aria-label="Kind" defaultValue={current?.kind ?? "profile"} style={{ ...field, width: 180 }}>
            <option value="profile">Company profile</option><option value="methodology">Methodology</option><option value="cv">CV</option><option value="past_performance">Past performance</option><option value="other">Other</option>
          </select>
          <input name="title" aria-label="Title" placeholder="Title" defaultValue={current?.title} required style={field} />
        </div>
        <textarea name="body" aria-label="Text" placeholder="Text" defaultValue={current?.body} required style={{ ...field, minHeight: 140 }} />
        <select name="caseRecordId" aria-label="Case record" defaultValue={current?.caseRecordId ?? ""} style={field}>
          <option value="">No case record (required for past performance to be used)</option>
          {cases.map(c => <option key={c.id} value={c.id}>{c.deal}{c.authorized ? " (disclosure authorized)" : " (private)"}</option>)}
        </select>
        <div><button className="btn btn--primary" type="submit">{current ? "Save changes" : "Add block"}</button>{current && <Link className={ui.clear} href="/funding?tab=library" style={{ marginLeft: 10 }}>Cancel</Link>}</div>
      </form>
      {blocks.length > 0 && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Block</th><th>Kind</th><th>Usable in drafts</th><th /></tr></thead>
            <tbody>{blocks.map(({ b, authorized }) => (
              <tr key={b.id}>
                <td className={ui.wrap}><span className={ui.primary}>{b.title}</span><span className={ui.sub}>{b.body.slice(0, 160)}</span></td>
                <td>{b.kind.replace("_", " ")}</td>
                <td>{b.kind !== "past_performance" || authorized ? "Yes" : <span style={{ color: "#b0432f" }}>No: case record not authorized</span>}</td>
                <td><div className={ui.rowActions}>
                  <Link className={ui.miniBtn} style={{ display: "inline-flex", alignItems: "center" }} href={`/funding?tab=library&edit=${b.id}`}>Edit</Link>
                  <form action={deleteLibraryAction}><input type="hidden" name="id" value={b.id} /><button className={ui.miniBtn} type="submit">Delete</button></form>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

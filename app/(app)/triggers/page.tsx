import Link from "next/link";
import { Radar } from "lucide-react";
import FilterForm from "@/components/filter-form";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { listSignals, listTriggers, triggerStats } from "@/lib/crm/trigger-queries";
import { isOwner } from "@/lib/db/scoped";
import { TRIGGER_TYPES } from "@/lib/vocab";
import { scanNow, setTriggerStatus, toggleQuery } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Triggers" };

type SP = Record<string, string | undefined>;

const TYPE_CHIP: Record<string, string> = {
  capital: ui.chipPollen, procurement: ui.chipWater, crisis: ui.chipEmber, project: ui.chipReed,
  people: "", regulatory: ui.chipPollen, commitment: ui.chipReed, event: ui.chipMuted,
};
const SOURCE_LABEL: Record<string, string> = {
  gdelt: "GDELT news", ted: "EU TED", worldbank: "World Bank", edgar_form_d: "SEC Form D", gdacs: "GDACS", manual: "Manual",
};

function Meter({ value }: { value: number | null }) {
  if (value == null) return <span className={ui.chipMuted}>—</span>;
  return <span className={ui.meter}><span className={ui.meterBar}><span className={ui.meterFill} style={{ width: `${value}%` }} /></span>{value}</span>;
}

function parseSuggested(json: string | null): { path?: string; engagement?: string; titles?: string[]; location?: string } {
  try { return json ? JSON.parse(json) : {}; } catch { return {}; }
}

export default async function TriggersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/triggers");
  const sp = await searchParams;
  const tab = sp.tab === "signals" || sp.tab === "sources" ? sp.tab : "triggers";
  const stats = await triggerStats(user.scope);
  const signalsTotal = stats.bySource.reduce((a, r) => a + r.n, 0);
  const awaiting = stats.bySource.filter(r => r.status === "new").reduce((a, r) => a + r.n, 0);
  const hasAi = aiConfig() !== null;
  const owner = isOwner(user.scope);
  const back = `/triggers?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader title="Triggers" count={stats.open} actions={owner ? <form action={scanNow}><button className="btn" type="submit">Scan now</button></form> : undefined} />
      {!hasAi && awaiting > 0 && (
        <p className={ui.notice}>{awaiting} current signals are waiting for Claude to read them. Set <code>ANTHROPIC_API_KEY</code> (docs/ENV.md) to turn relevant ones into triggers with a decision read.</p>
      )}
      <nav className={ui.tabs} aria-label="Trigger views">
        <Link className={`${ui.tab} ${tab === "triggers" ? ui.tabActive : ""}`} href="/triggers">Triggers<span className={ui.tabCount}>{stats.open}</span></Link>
        <Link className={`${ui.tab} ${tab === "signals" ? ui.tabActive : ""}`} href="/triggers?tab=signals">All current signals<span className={ui.tabCount}>{signalsTotal}</span></Link>
        <Link className={`${ui.tab} ${tab === "sources" ? ui.tabActive : ""}`} href="/triggers?tab=sources">Sources and queries<span className={ui.tabCount}>{stats.queries.filter(q => q.enabled).length}</span></Link>
      </nav>

      {tab === "triggers" && <TriggersTab scope={user.scope} sp={sp} back={back} />}
      {tab === "signals" && <SignalsTab sp={sp} />}
      {tab === "sources" && <SourcesTab stats={stats} owner={owner} scanQueued={sp.scan === "queued"} />}
    </>
  );
}

async function TriggersTab({ scope, sp, back }: { scope: Parameters<typeof listTriggers>[0]; sp: SP; back: string }) {
  const rows = await listTriggers(scope, { type: sp.type, status: sp.status, source: sp.source, q: sp.q, minRelevance: sp.min ? Number(sp.min) : undefined });
  return (
    <div className={ui.workspace}>
      <FilterForm action="/triggers" className={ui.filters}>
        <p className={ui.filtersTitle}>Filters</p>
        <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Organization or event" /></div>
        <div className={ui.field}><label htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={sp.type ?? ""}><option value="">All types</option>{TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""}><option value="">Open (new, pursued, watched)</option><option value="new">New</option><option value="pursued">Pursued</option><option value="watched">Watched</option><option value="dismissed">Dismissed</option></select></div>
        <div className={ui.field}><label htmlFor="source">Source</label>
          <select id="source" name="source" defaultValue={sp.source ?? ""}><option value="">All sources</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="min">Minimum fit</label>
          <select id="min" name="min" defaultValue={sp.min ?? ""}><option value="">Any</option><option value="70">70+</option><option value="80">80+</option><option value="90">90+</option></select></div>
        <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/triggers">Clear</Link></div>
      </FilterForm>
      <div>
        <div className={ui.toolbar}><span className={ui.resultCount}>{rows.length} triggers from this year</span></div>
        {rows.length === 0 ? (
          <EmptyState icon={Radar} title="No triggers match" body="Triggers appear once Claude reads the current signals and finds a decision Regenera can help with. See All current signals for everything the scanners found." />
        ) : (
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Event and decision read</th><th>Organization</th><th>Type</th><th>Fit</th><th>Urgency</th><th>Date</th><th /></tr></thead>
              <tbody>
                {rows.map(r => {
                  const s = parseSuggested(r.suggested);
                  return (
                    <tr key={r.id}>
                      <td className={ui.wrap}>
                        <span className={ui.primary}>{r.summary}</span>
                        {r.decisionRead && <p className={ui.read}>{r.decisionRead}</p>}
                        <span className={ui.sub}>
                          {SOURCE_LABEL[r.source] ?? r.source}{r.sourceUrl && <> · <a href={r.sourceUrl} target="_blank" rel="noreferrer">source</a></>}
                          {s.engagement && <> · suggested: {s.engagement.replace(/_/g, " ")}</>}{s.titles?.length ? <> · approach: {s.titles.slice(0, 3).join(", ")}</> : null}
                        </span>
                      </td>
                      <td>{r.orgId ? <Link className={ui.primary} href={`/companies/${r.orgId}`}>{r.orgName}</Link> : "—"}<span className={ui.sub}>{r.orgLocation ?? r.country ?? ""}</span></td>
                      <td><span className={`${ui.chip} ${TYPE_CHIP[r.type] ?? ""}`}>{r.type}</span>{r.status !== "new" && <span className={ui.sub}>{r.status}</span>}</td>
                      <td><Meter value={r.relevance} /></td>
                      <td className={ui.num}>{r.urgency}/5</td>
                      <td>{r.eventDate}</td>
                      <td>
                        <div className={ui.rowActions}>
                          {(["pursued", "watched", "dismissed"] as const).filter(st => st !== r.status).map(st => (
                            <form key={st} action={setTriggerStatus}>
                              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={st} /><input type="hidden" name="back" value={back} />
                              <button className={`${ui.miniBtn} ${st === "pursued" ? ui.miniPrimary : ""}`} type="submit">{st === "pursued" ? "Pursue" : st === "watched" ? "Watch" : "Dismiss"}</button>
                            </form>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

async function SignalsTab({ sp }: { sp: SP }) {
  const rows = await listSignals({ source: sp.source, status: sp.status, q: sp.q });
  const STATUS: Record<string, string> = { new: "Waiting for Claude", relevant: "Relevant", irrelevant: "Not a fit", triggered: "Trigger created", error: "Error" };
  return (
    <div className={ui.workspace}>
      <FilterForm action="/triggers" className={ui.filters}>
        <input type="hidden" name="tab" value="signals" />
        <p className={ui.filtersTitle}>Filters</p>
        <div className={ui.field}><label htmlFor="sq">Search</label><input id="sq" name="q" defaultValue={sp.q} placeholder="Title, organization, country" /></div>
        <div className={ui.field}><label htmlFor="ssource">Source</label>
          <select id="ssource" name="source" defaultValue={sp.source ?? ""}><option value="">All sources</option>{Object.entries(SOURCE_LABEL).filter(([k]) => k !== "manual").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className={ui.field}><label htmlFor="sstatus">Status</label>
          <select id="sstatus" name="status" defaultValue={sp.status ?? ""}><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/triggers?tab=signals">Clear</Link></div>
      </FilterForm>
      <div>
        <div className={ui.toolbar}><span className={ui.resultCount}>{rows.length} current signals (this year only; tenders only while open)</span></div>
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Signal</th><th>Organization</th><th>Country</th><th>Source</th><th>Published</th><th>Deadline</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id}>
                  <td className={ui.wrap}><a className={ui.primary} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>{s.relevance != null && <span className={ui.sub}>fit {s.relevance}/100</span>}</td>
                  <td>{s.orgName ?? "—"}</td>
                  <td>{s.country ?? "—"}</td>
                  <td><span className={ui.chip}>{SOURCE_LABEL[s.source] ?? s.source}</span></td>
                  <td>{s.publishedAt.slice(0, 10)}</td>
                  <td>{s.deadline?.slice(0, 10) ?? "—"}</td>
                  <td><span className={`${ui.chip} ${s.status === "triggered" || s.status === "relevant" ? ui.chipReed : s.status === "new" ? ui.chipPollen : ui.chipMuted}`}>{STATUS[s.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SourcesTab({ stats, owner, scanQueued }: { stats: Awaited<ReturnType<typeof triggerStats>>; owner: boolean; scanQueued: boolean }) {
  const perSource = Object.entries(stats.bySource.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.source]: (acc[r.source] ?? 0) + r.n }), {}));
  return (
    <>
      {scanQueued && <p className={ui.notice}>Scan queued. It runs on the next job tick.</p>}
      <div className={ui.stats}>
        {perSource.map(([source, n]) => <div key={source} className={ui.stat}><b>{n}</b><span>{SOURCE_LABEL[source] ?? source} signals this year</span></div>)}
      </div>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>Query</th><th>Source</th><th>Type</th><th>Last run</th><th className={ui.num}>Found</th><th>Status</th></tr></thead>
          <tbody>
            {stats.queries.map(q => (
              <tr key={q.id}>
                <td className={ui.wrap}><span className={ui.primary}>{q.label}</span><span className={ui.sub}><code>{q.query}</code></span></td>
                <td>{SOURCE_LABEL[q.source] ?? q.source}</td>
                <td><span className={`${ui.chip} ${TYPE_CHIP[q.triggerType] ?? ""}`}>{q.triggerType}</span></td>
                <td>{q.lastRunAt ? q.lastRunAt.slice(0, 16).replace("T", " ") : "not yet"}</td>
                <td className={ui.num}>{q.lastCount ?? "—"}</td>
                <td>
                  {owner ? (
                    <form action={toggleQuery}><input type="hidden" name="id" value={q.id} /><button className={`${ui.miniBtn} ${q.enabled ? ui.miniPrimary : ""}`} type="submit">{q.enabled ? "On" : "Off"}</button></form>
                  ) : (q.enabled ? "On" : "Off")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

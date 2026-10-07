import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Radar } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { objectives, scanRuns } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { AUDIENCES, audience } from "@/lib/scan/audiences";
import { configProblems, creditCeiling, OPPORTUNITY_PROVIDERS, ORGANIZATION_PROVIDERS, SCAN_PROVIDERS, SCAN_SECTIONS, scanOutcome, type ScanSection } from "@/lib/scan/config";
import { COUNTRIES, countriesIn, expandGeography, geoLabel, REGION_LABELS, type GeoGroup } from "@/lib/scan/countries";
import { providerPlan } from "@/lib/scan/engine";
import { listPresets } from "@/lib/scan/presets";
import { PRESET_LIMITS, presetFormValues } from "@/lib/scan/preset-form";
import { offersFor } from "@/lib/scan/offers";
import { queryTerms } from "@/lib/scan/web";
import { startScanAction } from "../scan-actions";
import { logEffortAction } from "../flow-actions";
import { campaignEconomics } from "@/lib/flow/commercial";
import { PresetForm } from "./preset-form";
import s from "./scans.module.css";
import { filterRuns, pageOf } from "@/lib/scan/review-filters";
import { ReviewControls, ReviewPagination } from "./review-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scans" };

const EMPTY_PRESET = { name: "", section: "prospecting", note: "", mode: "organizations", audience: AUDIENCES[0]?.key ?? "", providers: ["existing", "web", "gleif"], maxOrganizations: "50", maxPeoplePerOrg: "0", researchBudgetUsd: "3", freshnessDays: "365", audienceExclusions: "apply" };

export default async function ScansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/scans");
  const sp = await searchParams;
  const ws = user.scope.mandateIds[0];
  const db = appDb();
  const tab = sp.tab === "runs" || sp.tab === "presets" || sp.tab === "economics" ? sp.tab : "launch";
  const economics = tab === "economics" ? await campaignEconomics(db, user.scope.mandateIds) : [];
  const presets = ws ? await listPresets(db, ws) : [];
  const runs = await db.select().from(scanRuns).where(and(inArray(scanRuns.mandateId, user.scope.mandateIds.length ? user.scope.mandateIds : ["-"]))).orderBy(desc(scanRuns.createdAt));
  const filteredRuns = filterRuns(runs, sp);
  const runPage = pageOf(filteredRuns, sp.page);
  const apollo = apolloConfig();
  const ai = aiConfig();
  const preset = presets.find(p => p.key === sp.preset) ?? presets[0];
  const a = preset ? audience(preset.config.audience) : null;
  const plan = preset ? providerPlan(preset.config, { apollo, ai }) : null;
  const external = preset ? preset.config.providers.filter(p => p === "web" || p === "apollo_orgs") : [];
  const blocked = !!plan && external.length > 0 && !external.some(p => plan.usable.includes(p));
  const problems = preset ? configProblems(preset.config) : [];
  const terms = preset ? queryTerms(a, preset.config) : null;
  const today = new Date().toISOString().slice(0, 10);
  const ranToday = preset ? runs.find(x => x.presetName === preset.name && (x.createdAt ?? "").slice(0, 10) === today && !["failed", "cancelled"].includes(x.status)) : undefined;
  const editing = tab === "presets" && sp.edit ? presets.find(p => p.key === sp.edit) : undefined;
  const objectiveRows = tab === "presets" && ws ? await db.select({ id: objectives.id, title: objectives.title }).from(objectives).where(eq(objectives.mandateId, ws)).orderBy(desc(objectives.updatedAt)).limit(100) : [];
  const countryCount = preset ? expandGeography(preset.config.geography).length : 0;

  return (
    <>
      <PageHeader title="Scans" actions={<Link className="btn" href="/companies">Organizations</Link>} />
      <p className={s.lead}>One scan engine for every section. A scan finds and screens organizations or opportunities against written criteria and records why each matched; it never contacts anyone, enrolls anyone or creates an opportunity. People review and qualify.</p>
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Scan views">
        <Link className={`${ui.tab} ${tab === "launch" ? ui.tabActive : ""}`} href="/scans">Run a scan</Link>
        <Link className={`${ui.tab} ${tab === "runs" ? ui.tabActive : ""}`} href="/scans?tab=runs">Runs ({runs.length})</Link>
        <Link className={`${ui.tab} ${tab === "presets" ? ui.tabActive : ""}`} href="/scans?tab=presets">Presets</Link>
        <Link className={`${ui.tab} ${tab === "economics" ? ui.tabActive : ""}`} href="/scans?tab=economics">Campaign economics</Link>
      </nav>

      {tab === "launch" && preset && plan && terms && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Choose a preset</p>
            <form method="get" action="/scans" className={s.pick}>
              <label htmlFor="preset">Preset</label>
              <select id="preset" name="preset" defaultValue={preset.key}>
                {Object.entries(SCAN_SECTIONS).map(([k, label]) => {
                  const list = presets.filter(p => p.section === k);
                  return list.length ? <optgroup key={k} label={label}>{list.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup> : null;
                })}
              </select>
              <button className={ui.miniBtn} type="submit">Show scope</button>
              {!preset.builtIn && <Link className={ui.miniBtn} href={`/scans?tab=presets&edit=${preset.key}`}>Edit preset</Link>}
            </form>
            <h2 className={s.h2}>{preset.name}</h2>
            <p className={ui.sub}>{preset.note}</p>
            <p className={r.panelTitle} style={{ marginTop: 14 }}>Preflight: what will run</p>
            <dl className={r.kv}>
              <dt>Looking for</dt><dd>{preset.config.mode === "opportunities" ? <>Projects and opportunities matching: {preset.config.capabilities.join(", ") || terms.include.join(", ") || "no criteria"}</> : <>{a?.label ?? preset.config.audience}<span className={ui.sub}>{a?.purpose}</span></>}</dd>
              <dt>Geography</dt><dd>{preset.config.geography.length ? <>{preset.config.geography.map(geoLabel).join(", ")} <span className={ui.sub}>{countryCount} countr{countryCount === 1 ? "y" : "ies"}</span></> : "Worldwide (no country filter)"}</dd>
              {terms.sector && <><dt>Sector</dt><dd>{terms.sector}</dd></>}
              <dt>Query terms sent</dt><dd>{terms.include.join(", ") || "None"}</dd>
              <dt>Excluded when mentioned</dt><dd>{terms.exclude.join(", ") || "None"}{preset.config.audienceExclusions === "ignore" ? " (audience defaults turned off)" : ""}</dd>
              <dt>Freshness</dt><dd>Sources from the last {preset.config.freshnessDays} days where time matters (open web)</dd>
              {preset.config.mode === "organizations" && a && <>
                <dt>Decision makers</dt><dd>{(preset.config.titles.length ? preset.config.titles : a.titles).join(", ")}</dd>
                <dt>Buying events</dt><dd>{preset.config.signalCriteria || a.buyingEvents.join("; ")} <span className={ui.sub}>Recorded as questions for review; a scan does not prove intent.</span></dd>
                <dt>Offers</dt><dd>{offersFor(a.key).map(o => o.name).join("; ") || a.entryOffer}</dd>
              </>}
              <dt>Expected output</dt><dd>Up to {preset.config.maxOrganizations} {preset.config.mode === "opportunities" ? "matched items" : "new organizations from external sources"}{preset.config.providers.includes("existing") ? `, plus up to ${preset.config.maxOrganizations} workspace records re-screened (not counted as new)` : ""}. Every result needs human review. Fewer is normal when evidence is thin.</dd>
            </dl>
            {problems.length > 0 && <div className={s.errors} role="alert"><b>This preset cannot run as saved.</b><ul>{problems.map(x => <li key={x}>{x}</li>)}</ul></div>}
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Sources and cost</p>
              <ul className={s.providers}>{plan.statuses.map(p => {
                const meta = SCAN_PROVIDERS[p.provider as keyof typeof SCAN_PROVIDERS];
                return (
                  <li key={p.provider} data-status={p.status}><b>{meta.label}</b> <span className={s.pstatus}>{p.status === "ok" ? (meta.scope === "workspace" ? "Workspace match" : "Will search") : p.status === "not_connected" ? "Not connected" : "Skipped"}</span>
                    <span className={ui.sub}>{p.status === "ok" ? meta.note : p.detail}</span></li>
                );
              })}</ul>
              <form action={startScanAction} className={s.start}>
                <input type="hidden" name="preset" value={preset.key} /><input type="hidden" name="section" value={preset.section} /><input type="hidden" name="back" value={`/scans?preset=${preset.key}`} />
                <label>Maximum {preset.config.mode === "opportunities" ? "items" : "new organizations"}<input name="maxOrganizations" type="number" min={1} max={500} defaultValue={preset.config.maxOrganizations} /></label>
                {preset.config.mode === "organizations" && <label>People per organization (Apollo search, 0 = none)<input name="maxPeoplePerOrg" type="number" min={0} max={10} defaultValue={preset.config.maxPeoplePerOrg} disabled={!apollo} /></label>}
                <p className={ui.sub}>Open-web research budget: ${preset.config.researchBudgetUsd} of Claude spend (every search and page read is logged against the scan). Credit ceiling: {creditCeiling(preset.config)} Apollo credit{creditCeiling(preset.config) === 1 ? "" : "s"} (organization search pages; people search returns no emails). Enrichment is never run by a scan.</p>
                {blocked && <label className={s.fallback}><input type="checkbox" name="fallback" /> No external discovery source is connected (open web needs Claude; Apollo needs its key). Run on the public GLEIF register and existing records instead: the register gives legal identity only (name, jurisdiction), so most matches stay &quot;partial&quot; until reviewed. <Link href="/settings/claude">Connect Claude</Link> · <Link href="/settings/connections">Connect Apollo</Link></label>}
                {ranToday && <p className={ui.sub}>This preset already ran today: <Link href={`/scans/${ranToday.id}`}>show the previous run ({scanOutcome(ranToday)})</Link>. Starting again opens that run unless you ask for a fresh one.</p>}
                {ranToday && <label className={s.inline}><input type="checkbox" name="fresh" /> Run fresh (after a connection or scope change). Budgets apply again.</label>}
                <button className="btn btn--primary" type="submit" disabled={problems.length > 0}>Start scan</button>
                <p className={ui.sub}>Runs in the background in bounded steps. An identical running scan is opened rather than duplicated; up to 3 scans run at once per workspace.</p>
              </form>
            </section>
          </aside>
        </div>
      )}

      {tab === "runs" && <ReviewControls path="/scans" sp={{ ...sp, tab: "runs" }} kind="runs" total={runs.length} filtered={filteredRuns.length} providers={[...new Set(runs.flatMap(x => x.providers.map(p => p.provider)))].sort()} />}
      {tab === "runs" && (filteredRuns.length === 0 ? <EmptyState icon={Radar} title={runs.length ? "No scans match these filters" : "No scans yet"} body={runs.length ? "Clear filters to see all scans." : "Run a preset from the first tab. Each run keeps its sources, counts, costs and every result with the reason it matched or was excluded."} /> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Scan</th><th>Outcome</th><th>New</th><th>Already held</th><th>Re-screened</th><th>Matches</th><th>Excluded</th><th>To review</th><th>People</th><th>Credits</th><th>Started</th></tr></thead>
          <tbody>{runPage.rows.map(x => (
            <tr key={x.id}>
              <td className={ui.primary}><Link href={`/scans/${x.id}`}>{x.presetName || audience(x.audience)?.label}</Link><span className={ui.sub}>{SCAN_SECTIONS[x.section as ScanSection] ?? x.section} · by {x.requestedBy}</span></td>
              <td><span className={ui.chip}>{scanOutcome(x)}</span></td>
              <td className={ui.num}>{x.counts.new ?? 0}</td><td className={ui.num}>{x.counts.existing ?? 0}</td><td className={ui.num}>{x.counts.rescreened ?? 0}</td>
              <td className={ui.num}>{(x.counts.matching ?? 0)}{x.counts.partial ? ` (+${x.counts.partial} partial)` : ""}</td>
              <td className={ui.num}>{x.counts.excluded ?? 0}</td><td className={ui.num}>{x.counts.needsReview ?? 0}</td><td className={ui.num}>{x.counts.people ?? 0}</td><td className={ui.num}>{x.creditsUsed}/{x.creditCeiling}</td>
              <td className={ui.sub}>{(x.startedAt ?? x.createdAt).slice(0, 16).replace("T", " ")}</td>
            </tr>))}</tbody>
        </table></div>
      ))}
      {tab === "runs" && <ReviewPagination path="/scans" sp={{ ...sp, tab: "runs" }} {...runPage} />}

      {tab === "economics" && (
        <section className={r.panel} aria-labelledby="econ-h">
          <p className={r.panelTitle}><span id="econ-h">Campaign economics</span><span>From event history, by original source</span></p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Each organization and opportunity counts once, under its original source (scan preset, campaign or channel); later touches are influence and are not counted here. Proposal and signed counts come from stage changes that happened, not from where records sit today. Fees are Regenera&apos;s estimated fee (USD); collected is paid invoices on engagements linked to the opportunity. Test records are excluded.</p>
          {economics.length === 0 ? <p className={r.empty}>No attributed records yet. Scans attribute the organizations they create; record a source on opportunities as you create them.</p> : (
            <div className={ui.tableWrap}><table className={ui.table}>
              <thead><tr><th>Source</th><th>Discovered</th><th>Reviewed</th><th>Qualified</th><th>Meetings</th><th>Opportunities</th><th>Reached proposal</th><th>Signed</th><th>Signed fees</th><th>Collected</th><th>Credits</th><th>Claude $</th><th>Hours</th></tr></thead>
              <tbody>{economics.map(e => <tr key={e.campaign}><td className={ui.primary}>{e.campaign}</td><td className={ui.num}>{e.discovered}</td><td className={ui.num}>{e.reviewed}</td><td className={ui.num}>{e.qualified}</td><td className={ui.num}>{e.meetings}</td><td className={ui.num}>{e.opportunities}</td><td className={ui.num}>{e.reachedProposal}</td><td className={ui.num}>{e.signed}</td><td className={ui.num}>{e.signedFees ? `USD ${Math.round(e.signedFees).toLocaleString("en-US")}` : "0"}</td><td className={ui.num}>{e.collected ? `USD ${Math.round(e.collected).toLocaleString("en-US")}` : "0"}</td><td className={ui.num}>{e.credits}</td><td className={ui.num}>{e.aiUsd.toFixed(2)}</td><td className={ui.num}>{(e.minutes / 60).toFixed(1)}</td></tr>)}</tbody>
            </table></div>
          )}
          <form action={logEffortAction} className={s.start} style={{ maxWidth: 520, marginTop: 14 }}>
            <p className={ui.sub} style={{ margin: 0 }}><b>Log time on a campaign</b> (founder or team effort, for cost per qualified meeting)</p>
            <label>Campaign or preset name<input name="campaign" required /></label>
            <label>Minutes<input name="minutes" type="number" min={1} max={1440} required /></label>
            <label>Date<input name="on" type="date" /></label>
            <label>Note<input name="note" /></label>
            <button className="btn" type="submit">Log time</button>
          </form>
        </section>
      )}

      {tab === "presets" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Presets</p>
            <table className={ui.table}><thead><tr><th>Preset</th><th>Looks for</th><th>Geography</th><th>Sources</th></tr></thead>
              <tbody>{presets.map(p => <tr key={p.key}><td className={ui.primary}><Link href={`/scans?preset=${p.key}`}>{p.name}</Link><span className={ui.sub}>{p.builtIn ? "Built in" : <Link href={`/scans?tab=presets&edit=${p.key}`}>Saved in this workspace · edit</Link>} · {SCAN_SECTIONS[p.section]}</span></td>
                <td>{p.config.mode === "opportunities" ? "Opportunities" : audience(p.config.audience)?.label}</td><td>{p.config.geography.map(geoLabel).join(", ") || "Worldwide"}</td><td>{p.config.providers.map(x => SCAN_PROVIDERS[x].label).join(", ")}</td></tr>)}</tbody></table>
            <p className={ui.sub}>Preset names describe a search, not a market fact: every result still needs evidence and review. Built-in presets cannot be edited; open one, then save it under a new name to adapt it.</p>
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>{editing ? `Edit "${editing.name}"` : "Save a preset"}</p>
              <PresetForm
                initial={editing ? presetFormValues(editing) : EMPTY_PRESET}
                editing={!!editing && !editing.builtIn}
                sections={Object.entries(SCAN_SECTIONS).map(([value, label]) => ({ value, label }))}
                audiences={AUDIENCES.map(x => ({ value: x.key, label: x.label }))}
                objectives={objectiveRows.map(o => ({ value: o.id, label: o.title }))}
                providers={(Object.keys(SCAN_PROVIDERS) as (keyof typeof SCAN_PROVIDERS)[]).filter(k => k !== "apollo_people").map(k => ({
                  key: k, label: SCAN_PROVIDERS[k].label, scope: SCAN_PROVIDERS[k].scope, note: SCAN_PROVIDERS[k].note,
                  mode: k === "web" ? "both" : (OPPORTUNITY_PROVIDERS as readonly string[]).includes(k) ? "opportunities" : (ORGANIZATION_PROVIDERS as readonly string[]).includes(k) ? "organizations" : "both",
                }))}
                geo={{
                  groups: (Object.keys(REGION_LABELS) as GeoGroup[]).map(g => ({ value: g, label: `${REGION_LABELS[g]} (${countriesIn(g).length})` })),
                  countries: COUNTRIES.map(c => ({ value: c.iso3, label: `${c.name} (${c.iso3})`, region: c.region })),
                }}
                limits={{ ...PRESET_LIMITS }}
              />
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

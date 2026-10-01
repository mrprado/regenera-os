import Link from "next/link";
import { and, desc, inArray } from "drizzle-orm";
import { Radar } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { scanRuns } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { AUDIENCES, audience } from "@/lib/scan/audiences";
import { creditCeiling, SCAN_PROVIDERS, SCAN_SECTIONS, SCAN_STATUS_LABEL as STATUS_LABEL, type ScanSection } from "@/lib/scan/config";
import { countryName, REGION_LABELS } from "@/lib/scan/countries";
import { providerPlan } from "@/lib/scan/engine";
import { listPresets } from "@/lib/scan/presets";
import { offersFor } from "@/lib/scan/offers";
import { savePresetAction, startScanAction } from "../scan-actions";
import { logEffortAction } from "../flow-actions";
import { campaignEconomics } from "@/lib/flow/commercial";
import s from "./scans.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scans" };

const geoLabel = (g: string) => (g in REGION_LABELS ? REGION_LABELS[g as keyof typeof REGION_LABELS] : countryName(g));

export default async function ScansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/scans");
  const sp = await searchParams;
  const ws = user.scope.mandateIds[0];
  const db = appDb();
  const tab = sp.tab === "runs" || sp.tab === "presets" || sp.tab === "economics" ? sp.tab : "launch";
  const economics = tab === "economics" ? await campaignEconomics(db, user.scope.mandateIds) : [];
  const section = (sp.section && sp.section in SCAN_SECTIONS ? sp.section : "prospecting") as ScanSection;
  const presets = ws ? await listPresets(db, ws) : [];
  const runs = await db.select().from(scanRuns).where(and(inArray(scanRuns.mandateId, user.scope.mandateIds.length ? user.scope.mandateIds : ["-"]))).orderBy(desc(scanRuns.createdAt)).limit(50);
  const apollo = apolloConfig();
  const preset = presets.find(p => p.key === sp.preset) ?? presets[0];
  const a = preset ? audience(preset.config.audience) : null;
  const ai = aiConfig();
  const plan = preset ? providerPlan(preset.config, { apollo, ai }) : null;
  const external = preset ? preset.config.providers.filter(p => p === "web" || p === "apollo_orgs") : [];
  const blocked = !!plan && external.length > 0 && !external.some(p => plan.usable.includes(p));

  return (
    <>
      <PageHeader title="Scans" actions={<Link className="btn" href="/companies">Organizations</Link>} />
      <p className={s.lead}>One scan engine for every section. A scan finds and screens organizations against written criteria and records why each matched; it never contacts anyone, enrolls anyone or creates an opportunity. People review and qualify.</p>
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Scan views">
        <Link className={`${ui.tab} ${tab === "launch" ? ui.tabActive : ""}`} href="/scans">Run a scan</Link>
        <Link className={`${ui.tab} ${tab === "runs" ? ui.tabActive : ""}`} href="/scans?tab=runs">Runs ({runs.length})</Link>
        <Link className={`${ui.tab} ${tab === "presets" ? ui.tabActive : ""}`} href="/scans?tab=presets">Presets</Link>
        <Link className={`${ui.tab} ${tab === "economics" ? ui.tabActive : ""}`} href="/scans?tab=economics">Campaign economics</Link>
      </nav>

      {tab === "launch" && preset && a && plan && (
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
            </form>
            <h2 className={s.h2}>{preset.name}</h2>
            <p className={ui.sub}>{preset.note}</p>
            <dl className={r.kv} style={{ marginTop: 12 }}>
              <dt>Audience</dt><dd>{a.label}<span className={ui.sub}>{a.purpose}</span></dd>
              <dt>Geography</dt><dd>{preset.config.geography.length ? preset.config.geography.map(geoLabel).join(", ") : "Any (no geography filter)"}</dd>
              <dt>Organization terms</dt><dd>{[...a.orgTerms, ...preset.config.terms].join(", ")}</dd>
              <dt>Excluded when mentioned</dt><dd>{a.exclude ? a.exclude.source.replace(/\\b|\(|\)|\//g, "").split("|").join(", ") : "None"}{preset.config.excludeTerms.length ? `, ${preset.config.excludeTerms.join(", ")}` : ""}</dd>
              <dt>Decision makers</dt><dd>{a.titles.join(", ")}</dd>
              <dt>Buying events</dt><dd>{a.buyingEvents.join("; ")} <span className={ui.sub}>Recorded as questions for review; a scan does not prove intent.</span></dd>
              <dt>Offers</dt><dd>{offersFor(a.key).map(o => o.name).join("; ") || a.entryOffer}</dd>
              <dt>Captured before qualification</dt><dd>{a.capture.join(", ")}</dd>
            </dl>
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Sources and cost</p>
              <ul className={s.providers}>{plan.statuses.map(p => (
                <li key={p.provider} data-status={p.status}><b>{SCAN_PROVIDERS[p.provider as keyof typeof SCAN_PROVIDERS].label}</b> <span className={s.pstatus}>{p.status === "ok" ? "Will run" : p.status === "not_connected" ? "Not connected" : "Skipped"}</span>
                  <span className={ui.sub}>{p.status === "ok" ? SCAN_PROVIDERS[p.provider as keyof typeof SCAN_PROVIDERS].note : p.detail}</span></li>
              ))}</ul>
              <form action={startScanAction} className={s.start}>
                <input type="hidden" name="preset" value={preset.key} /><input type="hidden" name="section" value={preset.section} /><input type="hidden" name="back" value={`/scans?preset=${preset.key}`} />
                <label>Maximum organizations<input name="maxOrganizations" type="number" min={1} max={500} defaultValue={preset.config.maxOrganizations} /></label>
                <label>People per organization (Apollo search, 0 = none)<input name="maxPeoplePerOrg" type="number" min={0} max={10} defaultValue={preset.config.maxPeoplePerOrg} disabled={!apollo} /></label>
                <p className={ui.sub}>Open-web research budget: ${preset.config.researchBudgetUsd} of Claude spend for this scan (every search and page read is logged against the scan). Credit ceiling: {creditCeiling(preset.config)} Apollo credit{creditCeiling(preset.config) === 1 ? "" : "s"} (organization search pages; people search returns no emails). Repeated searches within a day reuse the cached page. Enrichment is never run by a scan.</p>
                {blocked && <label className={s.fallback}><input type="checkbox" name="fallback" /> No external discovery source is connected (open web needs Claude; Apollo needs its key). Run on the public GLEIF register and existing records instead: the register gives legal identity only (name, jurisdiction), so most matches stay &quot;partial&quot; until reviewed. <Link href="/settings/claude">Connect Claude</Link> · <Link href="/settings/connections">Connect Apollo</Link></label>}
                <button className="btn btn--primary" type="submit">Start scan</button>
                <p className={ui.sub}>Runs in the background in bounded steps. Same preset and settings on the same day returns the existing run. One scan per audience runs at a time.</p>
              </form>
            </section>
          </aside>
        </div>
      )}

      {tab === "runs" && (runs.length === 0 ? <EmptyState icon={Radar} title="No scans yet" body="Run a preset from the first tab. Each run keeps its sources, counts, costs and every result with the reason it matched or was excluded." /> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Scan</th><th>Status</th><th>Found</th><th>New</th><th>Matches</th><th>Excluded</th><th>To review</th><th>People</th><th>Credits</th><th>Started</th></tr></thead>
          <tbody>{runs.map(x => (
            <tr key={x.id}>
              <td className={ui.primary}><Link href={`/scans/${x.id}`}>{x.presetName || audience(x.audience)?.label}</Link><span className={ui.sub}>{SCAN_SECTIONS[x.section as ScanSection] ?? x.section} · by {x.requestedBy}</span></td>
              <td><span className={ui.chip}>{STATUS_LABEL[x.status]}</span></td>
              <td className={ui.num}>{x.counts.found ?? 0}</td><td className={ui.num}>{x.counts.new ?? 0}</td><td className={ui.num}>{(x.counts.matching ?? 0)}{x.counts.partial ? ` (+${x.counts.partial} partial)` : ""}</td>
              <td className={ui.num}>{x.counts.excluded ?? 0}</td><td className={ui.num}>{x.counts.needsReview ?? 0}</td><td className={ui.num}>{x.counts.people ?? 0}</td><td className={ui.num}>{x.creditsUsed}/{x.creditCeiling}</td>
              <td className={ui.sub}>{(x.startedAt ?? x.createdAt).slice(0, 16).replace("T", " ")}</td>
            </tr>))}</tbody>
        </table></div>
      ))}

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
            <table className={ui.table}><thead><tr><th>Preset</th><th>Audience</th><th>Geography</th><th>Sources</th></tr></thead>
              <tbody>{presets.map(p => <tr key={p.key}><td className={ui.primary}><Link href={`/scans?preset=${p.key}`}>{p.name}</Link><span className={ui.sub}>{p.builtIn ? "Built in" : "Saved in this workspace"} · {SCAN_SECTIONS[p.section]}</span></td><td>{audience(p.config.audience)?.label}</td><td>{p.config.geography.map(geoLabel).join(", ") || "Any"}</td><td>{p.config.providers.map(x => SCAN_PROVIDERS[x].label).join(", ")}</td></tr>)}</tbody></table>
            <p className={ui.sub}>Preset names describe a search, not a market fact: every result still needs evidence and review.</p>
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Save a preset</p>
              <form action={savePresetAction} className={s.start}>
                <label>Name<input name="name" required minLength={3} maxLength={120} /></label>
                <label>Section<select name="section" defaultValue={section}>{Object.entries(SCAN_SECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Audience<select name="audience">{AUDIENCES.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
                <label>Geography (ISO3 codes or regions: {Object.keys(REGION_LABELS).join(", ")})<input name="geography" placeholder="MEX, central_america_caribbean" /></label>
                <label>Extra organization terms<input name="terms" placeholder="solar, storage" /></label>
                <label>Exclude when mentioned<input name="excludeTerms" placeholder="residential" /></label>
                <fieldset className={s.fs}><legend>Sources</legend>
                  {(Object.keys(SCAN_PROVIDERS) as (keyof typeof SCAN_PROVIDERS)[]).filter(k => k !== "apollo_people").map(k => <label key={k}><input type="checkbox" name="providers" value={k} defaultChecked={k !== "apollo_orgs" || !!apollo} /> {SCAN_PROVIDERS[k].label}</label>)}
                </fieldset>
                <label>Maximum organizations<input name="maxOrganizations" type="number" min={1} max={500} defaultValue={50} /></label>
                <label>Buying events to look for<input name="signalCriteria" placeholder="new market entry, fund close" /></label>
                <label>Note<input name="note" /></label>
                <button className="btn btn--primary" type="submit">Save preset</button>
              </form>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

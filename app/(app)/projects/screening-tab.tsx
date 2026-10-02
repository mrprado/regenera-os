// Project 360 → Environmental & spatial screening (WRI integration §9–13, §23). Server component.
// Three separate evidence readings, source-backed screening flags (observations, not legal conclusions), the WRI
// panels (water, land transition, energy access) assembled from the latest site intelligence run, impact / ESG
// attributes with their evidence, and the "Data sources" block every export carries.
import Link from "next/link";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalProfiles, contracts, finModels, permits, projectAttributes, projectDatasetLinks, projectJurisdictions, projectScreeningFlags, requirements, siteIntelRuns, studies } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { DATASETS, datasetOf } from "@/lib/data-providers/catalog";
import { dataSourcesBlock } from "@/lib/data-providers/engine";
import { ALIGNMENT_SIGNALS, CLAIM_STATES, evidenceReadings, IMPACT_ATTRIBUTES, mandateAlignment, READINGS, SCREENING_FLAGS } from "@/lib/data-providers/evidence";
import { energyAccessOpportunity } from "@/lib/data-providers/wri/energy-access-explorer";
import { landTransition } from "@/lib/data-providers/wri/land-carbon-lab";
import { waterImplications } from "@/lib/data-providers/wri/aqueduct";
import { addAttributeAction, refreshScreeningAction, reviewFlagAction } from "../data-actions";
import f from "../funding/funding.module.css";

const TONE: Record<string, string> = { high: "confirmed", complete: "confirmed", partial: "incomplete", low: "blocked", incomplete: "blocked", none: "blocked" };

export default async function ScreeningTab({ project }: { project: { id: string; mandateId: string; name: string; country: string | null } }) {
  const db = appDb();
  const [run] = await db.select().from(siteIntelRuns).where(and(eq(siteIntelRuns.projectId, project.id), inArray(siteIntelRuns.status, ["complete", "partial"]))).orderBy(desc(siteIntelRuns.createdAt)).limit(1);
  const [flags, links, js, reqs, ps, st, cts, models, attrs, investors] = await Promise.all([
    db.select().from(projectScreeningFlags).where(eq(projectScreeningFlags.projectId, project.id)),
    db.select().from(projectDatasetLinks).where(eq(projectDatasetLinks.projectId, project.id)),
    db.select({ id: projectJurisdictions.id }).from(projectJurisdictions).where(eq(projectJurisdictions.projectId, project.id)),
    db.select({ status: requirements.status, reviewedAt: requirements.reviewedAt, sourceTier: requirements.sourceTier }).from(requirements).where(eq(requirements.projectId, project.id)),
    db.select({ status: permits.status }).from(permits).where(eq(permits.projectId, project.id)),
    db.select({ type: studies.type, status: studies.status }).from(studies).where(eq(studies.projectId, project.id)),
    db.select({ kind: contracts.kind, title: contracts.title, status: contracts.status }).from(contracts).where(eq(contracts.projectId, project.id)),
    db.select({ id: finModels.id }).from(finModels).where(eq(finModels.projectId, project.id)).limit(1),
    db.select().from(projectAttributes).where(and(eq(projectAttributes.projectId, project.id), eq(projectAttributes.subjectType, "project"))),
    db.select({ id: capitalProfiles.id, name: capitalProfiles.name, impact: capitalProfiles.impact, notes: capitalProfiles.notes }).from(capitalProfiles).where(and(eq(capitalProfiles.mandateId, project.mandateId), isNull(capitalProfiles.archivedAt))).limit(80),
  ]);
  const facts = run ? run.stages.flatMap(s => (s.facts ?? []).map(x => ({ ...x, stage: s.key }))) : [];
  const done = run ? run.stages.filter(s => s.status === "done").map(s => s.key) : [];
  const dims = [...new Set(done.map(k => (k === "remote_sensing" ? "ecology" : k === "infrastructure" ? "grid" : k)))];
  const docs = cts.filter(c => ["signed", "completed", "registered"].includes(c.status)).map(c => `${c.kind} ${c.title}`.toLowerCase()).flatMap(t => [/ppa|offtake|power purchase/.test(t) && "ppa", /lease|title|land/.test(t) && "lease", /opinion|legal/.test(t) && "legal_opinion"].filter((x): x is string => !!x));
  if (models.length) docs.push("model");
  const ev = evidenceReadings({
    screeningSources: [...new Set(facts.map(x => x.datasetId ?? x.source.split(" ·")[0]))], screeningDimensions: dims,
    jurisdictions: js.length, requirements: reqs.length, requirementsVerified: reqs.filter(q => q.reviewedAt).length, permits: ps.length, permitsApproved: ps.filter(x => x.status === "approved").length,
    level2Sources: reqs.filter(q => q.sourceTier === 2).length, studies: st, documents: docs,
  });
  const aq = facts.filter(x => x.datasetId === "wri.aqueduct.baseline_water_stress" && x.data);
  const loss = facts.find(x => x.datasetId === "wri.gfw.tree_cover_loss" && x.data);
  const natural = facts.find(x => x.label === "Natural cover");
  const tx = facts.find(x => /transmission/i.test(x.label));
  const access = facts.find(x => /access to electricity/i.test(x.label));
  const ghi = facts.find(x => /solar|ghi|irradiation/i.test(x.label));
  const land = landTransition({ currentSystem: facts.filter(x => x.stage === "ecology" && x.label !== "Natural cover" && /ha ·/.test(x.value)).slice(0, 3).map(x => `${x.label} ${x.value}`).join("; ") || null, lossTotalHa: loss ? Number(loss.data!.totalHa) : null, lossRecentHa: loss ? Number(loss.data!.recentHa) : null, recentFrom: loss ? Number(loss.data!.recentFrom) : null, naturalPct: natural ? Number(natural.value.match(/\((\d+(\.\d+)?)%\)/)?.[1] ?? NaN) || null : null, primaryForestHa: null, carbonNote: null, restorationNote: null, constraints: flags.filter(x => x.status === "open").map(x => SCREENING_FLAGS[x.flag as keyof typeof SCREENING_FLAGS]?.label ?? x.flag) });
  const kmOf = (v?: string) => { if (!v || /none mapped/i.test(v)) return null; const m = v.match(/([\d.]+)\s*(km|m)\b/); return m ? (m[2] === "m" ? Number(m[1]) / 1000 : Number(m[1])) : null; };
  const eae = energyAccessOpportunity(project.name, { accessPct: access ? Number(access.value.match(/[\d.]+/)?.[0]) : null, ruralAccessPct: null, population: null, gridKm: kmOf(tx?.value), health: null, schools: null, ghi: ghi?.value ?? null });
  const used = [...new Set([...links.map(l => l.datasetId), ...facts.map(x => x.datasetId).filter((x): x is string => !!x)])];
  const sources = dataSourcesBlock(used, (run?.finishedAt ?? run?.updatedAt ?? new Date().toISOString()).slice(0, 10));
  const alignment = investors.map(i => ({ i, a: mandateAlignment(attrs, [i.impact, i.notes].join(" "), false) })).filter(x => x.a.signal !== "outreach" && x.a.signal !== "unknown");

  return (
    <>
      <dl className={f.strip}>
        {(["screening", "development", "investment"] as const).map(k => (
          <div key={k}><dt>{k === "screening" ? "Screening confidence" : k === "development" ? "Development diligence" : "Investment diligence"}</dt><dd><span className={f.state} data-s={TONE[ev[k]]}>{READINGS[ev[k]]}</span></dd><p className={ui.sub} style={{ margin: "4px 0 0" }}>{ev.notes[k]}</p></div>
        ))}
      </dl>
      <p className={ui.sub} style={{ marginTop: -6 }}>Level 1 global screening (WRI, NASA, World Bank, OpenStreetMap…) → Level 2 jurisdictional diligence → Level 3 project-specific evidence. Three readings, never one score.</p>
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Screening flags</span><span className={ui.rowActions}>{run ? <span className={ui.sub}>From site intelligence {(run.finishedAt ?? run.updatedAt).slice(0, 10)}</span> : null}<form action={refreshScreeningAction}><input type="hidden" name="projectId" value={project.id} /><button className={ui.miniBtn} type="submit">Refresh</button></form><Link className={ui.miniBtn} href={`/map?project=${project.id}`}>Run site intelligence</Link></span></p>
            {flags.length === 0 ? <p className={r.empty}>{run ? "No screening flag raised by the latest run." : "Run site intelligence in Atlas; flags are computed from its sourced observations."}</p> : (
              <table className={ui.table}><thead><tr><th>Flag</th><th>Observed (source)</th><th>Potential implication</th><th>Required diligence</th><th>Status</th></tr></thead><tbody>
                {flags.map(x => (
                  <tr key={x.id}>
                    <td><b>{SCREENING_FLAGS[x.flag as keyof typeof SCREENING_FLAGS]?.label ?? x.flag}</b><span className={ui.sub}>Level {x.evidenceLevel} · {x.confidence}</span></td>
                    <td className={ui.wrap}>{x.observed}<span className={ui.sub}>{x.datasetId ? datasetOf(x.datasetId)?.name ?? x.datasetId : "Regenera records"}</span></td>
                    <td className={ui.wrap}>{x.implication}</td><td className={ui.wrap}>{x.diligence}</td>
                    <td><form action={reviewFlagAction} className={f.form}><input type="hidden" name="id" value={x.id} />
                      <select name="status" defaultValue={x.status} aria-label="Status"><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option></select>
                      <input name="note" defaultValue={x.reviewNote} placeholder="Review note (required to dismiss)" aria-label="Note" /><button className={ui.miniBtn} type="submit">Save</button></form>
                      {x.reviewedBy && <span className={ui.sub}>{x.reviewedBy}</span>}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
            <p className={ui.sub}>Flags are observations with sources. None is a legal conclusion, and none says a project is harmful or compliant.</p>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}><span>Water</span><Link href="/intelligence/data/wri">WRI Aqueduct</Link></p>
            {aq.length === 0 ? <p className={r.empty}>{facts.some(x => x.datasetId === "wri.aqueduct.baseline_water_stress") ? facts.find(x => x.datasetId === "wri.aqueduct.baseline_water_stress")!.value : "No Aqueduct reading yet: run site intelligence."}</p> : (
              <dl className={r.kv}>
                {aq.map(x => [<dt key={`${x.label}t`}>{x.label.replace(" (Aqueduct 4.0)", "")}</dt>, <dd key={`${x.label}d`}>{x.value}</dd>])}
                <dt>Potential project implications</dt><dd>{waterImplications(aq.map(x => ({ indicator: String(x.data!.indicator) as never, label: x.label, category: typeof x.data!.category === "number" ? (x.data!.category as number) : null, categoryLabel: x.value, score: null, raw: null }))).join("; ") || "None flagged at screening level"}</dd>
                <dt>Source</dt><dd>WRI Aqueduct 4.0 via Resource Watch · {aq[0].source.split(" · ")[1] ?? ""}</dd>
                <dt>Confidence</dt><dd>Global screening</dd>
                <dt>Diligence requirement</dt><dd>Local hydrological and regulatory diligence required</dd>
              </dl>
            )}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}><span>Land transition</span><Link href="/intelligence/data/wri">Global Forest Watch · Land &amp; Carbon Lab</Link></p>
            <dl className={r.kv}>
              <dt>Current land system</dt><dd>{land.currentSystem}</dd><dt>Historical trend</dt><dd>{land.historicalTrend}</dd><dt>Observed conversion</dt><dd>{land.observedConversion}</dd>
              <dt>Ecological significance</dt><dd>{land.ecologicalSignificance}</dd><dt>Carbon relevance</dt><dd>{land.carbonRelevance}</dd><dt>Restoration potential</dt><dd>{land.restorationPotential}</dd>
              <dt>Development constraints</dt><dd>{land.developmentConstraints}</dd><dt>Potential land-use conflicts</dt><dd>{land.landUseConflicts}</dd>
            </dl>
            <p className={ui.sub}>Separated: observed condition, potential risk, opportunity and required diligence. Nothing here classifies the project as harmful.</p>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}><span>Energy access opportunity</span><Link href="/intelligence/data/wri">Energy Access Explorer</Link></p>
            <dl className={r.kv}>
              <dt>Grid access</dt><dd>{eae.grid}</dd><dt>Population exposure</dt><dd>{eae.population}</dd><dt>Social infrastructure</dt><dd>{eae.socialInfrastructure}</dd>
              <dt>Productive-use demand</dt><dd>{eae.productiveUse}</dd><dt>Energy resource</dt><dd>{eae.energyResource}</dd><dt>Development opportunity</dt><dd>{eae.opportunity}</dd>
            </dl>
            <p style={{ fontSize: 13 }}>{eae.narrative}</p>
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Impact / ESG attributes</p>
            {attrs.length === 0 ? <p className={r.empty}>None recorded. Each attribute needs a source, methodology, evidence and confidence; unsupported claims are refused.</p> : (
              <ul className={r.timeline}>{attrs.map(a => <li key={a.id}><span className={r.when}>{CLAIM_STATES[a.verification as keyof typeof CLAIM_STATES] ?? a.verification}</span><span><b>{IMPACT_ATTRIBUTES[a.attribute as keyof typeof IMPACT_ATTRIBUTES] ?? a.attribute}</b>: {a.claim}<span className={ui.sub} style={{ display: "block" }}>{a.source} · {a.methodology} · confidence {a.confidence}</span></span></li>)}</ul>
            )}
            <details><summary className={ui.sub}>Add an attribute</summary>
              <form action={addAttributeAction} className={f.form} style={{ marginTop: 8 }}>
                <input type="hidden" name="projectId" value={project.id} />
                <select name="attribute" aria-label="Attribute">{Object.entries(IMPACT_ATTRIBUTES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="claim" required placeholder="Claim (what, how much, where)" aria-label="Claim" />
                <input name="source" required placeholder="Source" aria-label="Source" />
                <input name="methodology" required placeholder="Methodology" aria-label="Methodology" />
                <input name="evidence" placeholder="Evidence (document, dataset, study)" aria-label="Evidence" />
                <select name="datasetId" aria-label="Dataset"><option value="">No catalogue dataset</option>{DATASETS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                <select name="verification" aria-label="Verification">{Object.entries(CLAIM_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="confidence" aria-label="Confidence"><option value="unknown">Confidence unknown</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select>
                <button className={ui.miniBtn} type="submit">Record</button>
              </form>
            </details>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Mandate alignment signal</p>
            {alignment.length === 0 ? <p className={r.empty}>{attrs.length ? "No capital profile's stated thesis mentions these attributes: requires outreach." : "Record attributes first."}</p> : (
              <ul className={r.timeline}>{alignment.slice(0, 8).map(({ i, a }) => <li key={i.id}><span className={r.when}>{ALIGNMENT_SIGNALS[a.signal]}</span><span><Link href={`/capital/partners/${i.id}`}>{i.name}</Link> · {a.matched.map(m => IMPACT_ATTRIBUTES[m as keyof typeof IMPACT_ATTRIBUTES]).join(", ")}</span></li>)}</ul>
            )}
            <p className={ui.sub}>An attribute never means an investor will invest. Signals: verified, potential, unknown, requires outreach.</p>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Data sources</p>
            {sources.length === 0 ? <p className={r.empty}>No sources linked yet.</p> : <ol style={{ fontSize: 12, paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>{sources.map(s => <li key={s}>{s}</li>)}</ol>}
            <p className={ui.sub}>This block is carried into site-intelligence exports and memos. Datasets without redistribution rights are cited, never packaged.</p>
          </section>
        </aside>
      </div>
    </>
  );
}

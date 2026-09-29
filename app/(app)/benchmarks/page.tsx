import Link from "next/link";
import { and, asc, desc, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { costBenchmarks, technologies } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { BENCH_CONFIDENCE, MATURITY, METRICS, PRICE_BASIS, SOURCE_QUALITY, TECH_CATEGORIES } from "@/lib/benchmarks/vocab";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { addBenchmarkAction, addTechnologyAction, importBenchmarksAction } from "../benchmark-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Technology & cost benchmarks" };
const TABS = [["benchmarks", "Cost benchmarks"], ["technologies", "Technology library"], ["import", "Import"]] as const;

export default async function BenchmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/benchmarks");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "benchmarks";
  const db = appDb();
  const [bs, techs] = await Promise.all([
    db.select().from(costBenchmarks).where(and(mandateCondition(user.scope, costBenchmarks.mandateId), isNull(costBenchmarks.deletedAt))).orderBy(asc(costBenchmarks.technology), asc(costBenchmarks.metric), desc(costBenchmarks.baseYear)),
    db.select().from(technologies).where(mandateCondition(user.scope, technologies.mandateId)).orderBy(asc(technologies.category), asc(technologies.name)),
  ]);
  const shown = bs.filter(b => (!sp.tech || b.technology === sp.tech) && (!sp.metric || b.metric === sp.metric));
  const techKeys = [...new Set([...bs.map(b => b.technology), ...techs.map(t => t.key)])].sort();
  return (
    <>
      <PageHeader title="Technology & cost benchmarks" count={tab === "technologies" ? techs.length : shown.length} />
      <Notice text={sp.notice} />
      <p className={ui.sub}>Every benchmark carries its source, date, currency, base year, price basis, scale, country and scope. Comparisons normalise to USD in the comparison year (ECB / World Bank FX, World Bank US CPI) and show each step. Projects are compared on their Benchmarks tab; a deviation raises a question, never a conclusion. No figures are seeded: add them from sources you trust, or contribute Regenera&apos;s own project figures.</p>
      <nav className={ui.tabs} aria-label="Benchmark sections">{TABS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/benchmarks?tab=${k}`}>{l}</Link>)}</nav>
      {tab === "benchmarks" && <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Benchmarks</span><span className={ui.sub}>{sp.tech || sp.metric ? <Link href="/benchmarks">clear filter</Link> : null}</span></p>
          {shown.length === 0 ? <p className={r.empty}>No benchmarks yet.</p> : <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Technology</th><th>Metric</th><th>Value</th><th>Base year · basis</th><th>Where · scale</th><th>Scope</th><th>Source</th><th>Quality · confidence</th></tr></thead><tbody>
            {shown.map(b => <tr key={b.id}><td><Link href={`/benchmarks?tech=${b.technology}`}>{b.technology}</Link></td><td><Link href={`/benchmarks?metric=${b.metric}`}>{METRICS[b.metric]?.label ?? b.metric}</Link></td>
              <td className={ui.num}>{b.currency ? `${b.currency} ` : ""}{b.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className={ui.sub}>{METRICS[b.metric]?.unit}</span></td>
              <td>{b.baseYear ?? "?"} · {PRICE_BASIS[b.priceBasis]}</td><td className={ui.sub}>{[b.country, b.region, b.project].filter(Boolean).join(" · ") || "—"}{b.scaleValue ? ` · ${b.scaleValue} ${b.scaleUnit}` : ""}</td>
              <td className={ui.sub}>{[b.included && `incl. ${b.included}`, b.excluded && `excl. ${b.excluded}`].filter(Boolean).join(" · ") || "not stated"}</td>
              <td className={ui.sub}>{b.sourceUrl ? <a href={b.sourceUrl} target="_blank" rel="noreferrer">{b.source}</a> : b.source}{b.sourceDate ? ` (${b.sourceDate})` : ""}</td><td className={ui.sub}>{SOURCE_QUALITY[b.sourceQuality]} · {BENCH_CONFIDENCE[b.confidence]}</td></tr>)}
          </tbody></table></div>}
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>Add benchmark</p>
          <form action={addBenchmarkAction} className={r.form}>
            <label>Technology<input name="technology" list="techs" required placeholder="solar, bess, desalination…" /></label><datalist id="techs">{techKeys.map(k => <option key={k} value={k} />)}</datalist>
            <label>Metric<select name="metric">{Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.unit})</option>)}</select></label>
            <label>Value<input name="value" required inputMode="decimal" /></label><label>Currency<input name="currency" maxLength={3} placeholder="USD" /></label><label>Base year<input name="baseYear" inputMode="numeric" /></label>
            <label>Price basis<select name="priceBasis">{Object.entries(PRICE_BASIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Country (ISO3)<input name="country" /></label><label>Region<input name="region" placeholder="Latin America" /></label><label>Scale<input name="scaleValue" inputMode="decimal" /></label><label>Scale unit<input name="scaleUnit" placeholder="MW, MWh, m³/day" /></label>
            <label>Project / sample<input name="project" /></label><label>Included<input name="included" placeholder="EPC, interconnection…" /></label><label>Excluded<input name="excluded" placeholder="land, development, financing…" /></label>
            <label>Source<input name="source" required /></label><label>Source URL<input name="sourceUrl" type="url" /></label><label>Source date<input name="sourceDate" type="date" /></label>
            <label>Source quality<select name="sourceQuality" defaultValue="research">{Object.entries(SOURCE_QUALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Confidence<select name="confidence" defaultValue="moderate">{Object.entries(BENCH_CONFIDENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <button className="btn" type="submit">Add</button></form></section></aside>
      </div>}
      {tab === "technologies" && <div className={r.grid}>
        <section className={r.panel}><p className={r.panelTitle}>Technology library</p>
          {techs.length === 0 ? <p className={r.empty}>No technologies yet.</p> : <table className={ui.table}><thead><tr><th>Technology</th><th>Category</th><th>Maturity</th><th>Scale · life</th><th>Inputs → outputs</th><th>Intensity (water · land · energy)</th><th>Risks · financing</th></tr></thead><tbody>
            {techs.map(t => <tr key={t.id}><td className={ui.primary}><Link href={`/benchmarks?tech=${t.key}`}>{t.name}</Link><span className={ui.sub}>{t.description}</span></td><td>{TECH_CATEGORIES[t.category]}</td><td>{MATURITY[t.maturity]}{t.trl ? ` · TRL ${t.trl}` : ""}</td><td className={ui.sub}>{t.typicalScale || "—"}{t.usefulLifeYears ? ` · ${t.usefulLifeYears} yrs` : ""}</td><td className={ui.sub}>{t.inputs.join(", ") || "—"} → {t.outputs.join(", ") || "—"}</td><td className={ui.sub}>{[t.waterIntensity, t.landIntensity, t.energyIntensity].map(x => x || "—").join(" · ")}</td><td className={ui.sub}>{[t.technicalRisks, t.financingAvailability].filter(Boolean).join(" · ") || "—"}</td></tr>)}
          </tbody></table>}
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>Add technology</p>
          <form action={addTechnologyAction} className={r.form}>
            <label>Name<input name="name" required /></label><label>Key<input name="key" placeholder="auto from name" /></label><label>Category<select name="category">{Object.entries(TECH_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Description<textarea name="description" rows={2} /></label><label>Maturity<select name="maturity" defaultValue="mature">{Object.entries(MATURITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>TRL<input name="trl" inputMode="numeric" /></label>
            <label>Typical scale<input name="typicalScale" /></label><label>Useful life (yrs)<input name="usefulLifeYears" /></label><label>Efficiency<input name="efficiency" /></label>
            <label>Inputs (comma-separated)<input name="inputs" placeholder="Land, irradiance, water for cleaning" /></label><label>Outputs<input name="outputs" placeholder="Electricity" /></label>
            <label>Water intensity<input name="waterIntensity" /></label><label>Land intensity<input name="landIntensity" /></label><label>Energy intensity<input name="energyIntensity" /></label>
            <label>Technical risks<input name="technicalRisks" /></label><label>Financing availability<input name="financingAvailability" /></label><label>Geographic constraints<input name="geographicConstraints" /></label><label>Suppliers<input name="suppliers" /></label>
            <label>Source<input name="source" /></label><button className="btn" type="submit">Add</button></form></section></aside>
      </div>}
      {tab === "import" && <section className={r.panel}>
        <p className={r.panelTitle}>Import benchmarks (CSV)</p>
        <p className={ui.sub}>Header row with: technology, metric, value, currency, base_year, price_basis, country, region, scale_value, scale_unit, project, included, excluded, source, source_url, source_date, source_quality, confidence, notes. Rows without a source, a known metric, or a currency for money metrics are rejected with the reason. Cells are read as text, never evaluated. Metric keys: {Object.keys(METRICS).join(", ")}.</p>
        <form action={importBenchmarksAction} className={r.form}><label>CSV<textarea name="csv" rows={12} placeholder={"technology,metric,value,currency,base_year,country,source,source_date\nsolar,capex_per_mwac,980000,USD,2024,MEX,Supplier quote (DEMO),2024-11-02"} /></label><button className="btn" type="submit">Import</button></form>
      </section>}
    </>
  );
}

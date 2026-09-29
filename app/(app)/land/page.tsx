import Link from "next/link";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { landCandidates, siteFeatures } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { landFunnel } from "@/lib/natural/engine";
import { INTERVENTIONS, LAND_STAGES, TENURE } from "@/lib/natural/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { createLandAction } from "../natural-actions";
import s from "../projects/natural.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Land pipeline" };

export default async function LandPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/land");
  const sp = await searchParams;
  const db = appDb();
  const [rows, feats] = await Promise.all([
    db.select().from(landCandidates).where(mandateCondition(user.scope, landCandidates.mandateId)).orderBy(desc(landCandidates.updatedAt)),
    db.select({ id: siteFeatures.id, name: siteFeatures.name, measures: siteFeatures.measures }).from(siteFeatures).where(and(mandateCondition(user.scope, siteFeatures.mandateId), isNotNull(siteFeatures.geometry), eq(siteFeatures.visibility, "team"))).orderBy(desc(siteFeatures.createdAt)).limit(100),
  ]);
  const stage = sp.stage && sp.stage in LAND_STAGES ? sp.stage : null;
  const shown = stage ? rows.filter(x => x.stage === stage) : rows.filter(x => x.stage !== "dropped");
  const funnel = landFunnel(rows);
  const cur = rows[0]?.currency ?? "USD";
  return (
    <>
      <PageHeader title="Land pipeline" count={shown.length} actions={<Link className="btn" href="/map">Atlas regional search</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.sub}>Regional search → candidate land → screening → diligence → option → acquisition → project. Draw or save a polygon in Atlas → Workbench, then add it here; the boundary, hectares and a free ESA WorldCover land-cover baseline carry through to the project.</p>
      <div className={s.flow}>{funnel.map(f => <Link key={f.stage} href={`/land?stage=${f.stage}`} style={{ color: "inherit", textDecoration: "none", padding: "8px 10px", borderRight: "1px solid var(--line)", display: "grid", gap: 2 }}><span>{LAND_STAGES[f.stage]}</span><b>{f.count}</b><small className={ui.sub}>{Math.round(f.hectares).toLocaleString("en-US")} ha{f.capital ? ` · ${compactMoney(f.capital, cur)}` : ""}</small></Link>)}</div>
      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}><span>{stage ? LAND_STAGES[stage as keyof typeof LAND_STAGES] : "Open candidates"}</span><span className={ui.sub}><Link href="/land">Open</Link> · <Link href="/land?stage=dropped">Dropped</Link></span></p>
          {shown.length === 0 ? <p className={r.empty}>No candidates here.</p> : <table className={ui.table}><thead><tr><th>Candidate</th><th>Where</th><th>Stage</th><th>Hectares</th><th>Asking</th><th>Tenure</th><th>Intervention</th><th>Probability</th><th>Capital</th><th>Diligence</th></tr></thead><tbody>
            {shown.map(c => { const done = c.diligence.filter(d => d.status === "clear" || d.status === "n/a").length, issues = c.diligence.filter(d => d.status === "issue").length; return <tr key={c.id}>
              <td className={ui.primary}><Link href={`/land/${c.id}`}>{c.name}</Link>{c.projectId ? <span className={ui.sub}><Link href={`/projects/${c.projectId}`}>Project</Link></span> : null}</td>
              <td>{[c.country, c.subdivision].filter(Boolean).join(" · ") || "—"}</td><td><span className={ui.chip}>{LAND_STAGES[c.stage]}</span></td>
              <td className={ui.num}>{c.hectares ? Math.round(c.hectares).toLocaleString("en-US") : "—"}</td><td className={ui.num}>{c.askingPrice ? compactMoney(c.askingPrice, c.currency) : "—"}</td>
              <td>{TENURE[c.tenure]}</td><td>{c.intervention ? INTERVENTIONS[c.intervention] : "—"}</td><td className={ui.num}>{c.probabilityPct === null ? "—" : `${c.probabilityPct}%`}</td>
              <td className={ui.num}>{c.capitalRequired ? compactMoney(c.capitalRequired, c.currency) : "—"}</td><td className={ui.sub}>{done}/{c.diligence.length}{issues ? <span style={{ color: "#b0432f" }}> · {issues} issue(s)</span> : ""}</td></tr>; })}
          </tbody></table>}
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>Add candidate</p>
          <form action={createLandAction} className={r.form}>
            <label>Name<input name="name" required /></label>
            <label>From an Atlas polygon<select name="featureId" defaultValue=""><option value="">None: enter a location</option>{feats.map(f => <option key={f.id} value={f.id}>{f.name || "Unnamed feature"}{f.measures.areaHa ? ` · ${Math.round(f.measures.areaHa)} ha` : ""}</option>)}</select></label>
            <label>Country<input name="country" placeholder="MEX" /></label><label>State / region<input name="subdivision" /></label>
            <label>Latitude<input name="lat" inputMode="decimal" /></label><label>Longitude<input name="lng" inputMode="decimal" /></label>
            <label>Hectares<input name="hectares" inputMode="decimal" /></label><label>Asking price<input name="askingPrice" inputMode="decimal" /></label><label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label>
            <label>Tenure<select name="tenure" defaultValue="unclear">{Object.entries(TENURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Seller<input name="seller" /></label>
            <label>Intended intervention<select name="intervention" defaultValue=""><option value="">—</option>{Object.entries(INTERVENTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Capital required<input name="capitalRequired" inputMode="decimal" /></label><label>Acquisition probability %<input name="probabilityPct" inputMode="decimal" /></label>
            <label>Source<input name="source" placeholder="Broker, regional search, owner approach" /></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form></section></aside>
      </div>
    </>
  );
}

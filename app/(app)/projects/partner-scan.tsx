// Partner scan panel: one click scans for capital or delivery partners from this project's details (country or region,
// technology, size, stage, capital need), and shows the results here ranked best fit first, with the criteria each
// met and its source. Nothing is contacted; a person reviews and qualifies.
import Link from "next/link";
import { and, desc, eq, inArray, like, ne } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { scanResults, scanRuns, type projects } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { geoLabel } from "@/lib/scan/countries";
import { PARTNER_TYPES, reachOf, type PartnerType } from "@/lib/scan/project-scan";
import { ScanProgress } from "../scans/scan-progress";
import { startProjectScanAction } from "../project-scan-actions";

type Project = typeof projects.$inferSelect;
const MATCH_RANK: Record<string, number> = { matches: 0, partial: 1, unknown: 2 };

export default async function PartnerScanPanel({ project, group, back }: { project: Project; group?: "capital" | "delivery"; back?: string }) {
  const db = appDb();
  const types = (Object.keys(PARTNER_TYPES) as PartnerType[]).filter(k => !group || PARTNER_TYPES[k].group === group);
  const prefix = `${project.name.slice(0, 100)}: `;
  const allRuns = await db.select({ id: scanRuns.id, presetName: scanRuns.presetName, status: scanRuns.status, createdAt: scanRuns.createdAt })
    .from(scanRuns).where(and(eq(scanRuns.mandateId, project.mandateId), like(scanRuns.presetName, `${prefix}%`))).orderBy(desc(scanRuns.createdAt)).limit(20);
  const labelOf = (name: string) => name.slice(prefix.length);
  const inGroup = (name: string) => !group || types.some(t => PARTNER_TYPES[t].label === labelOf(name));
  // Latest run per partner type.
  const latest = [...new Map(allRuns.filter(x => inGroup(x.presetName)).map(x => [x.presetName, x] as const).reverse()).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const results = latest.length ? await db.select().from(scanResults).where(and(inArray(scanResults.runId, latest.map(x => x.id)), ne(scanResults.match, "excluded"), eq(scanResults.entityType, "organization"))).limit(400) : [];
  const groups = (["capital", "delivery"] as const).filter(g => types.some(t => PARTNER_TYPES[t].group === g));
  const backTo = back ?? `/projects/${project.id}?tab=${group === "capital" ? "capital" : "matches"}`;
  return <section className={r.panel} id="partner-scans">
    <p className={r.panelTitle}>Find {group === "capital" ? "capital partners" : group === "delivery" ? "delivery partners" : "partners"} for this project</p>
    <p className={ui.sub}>One click scans for organizations that fit this project: its country or region, technology, size, stage and what it needs. Results land below, best fit first, with the evidence. Uses open web (within the scan&apos;s research budget), the public company register and your records; no paid credits; nobody is contacted.</p>
    {groups.map(g => <div key={g} style={{ marginTop: 10 }}>
      {!group && <b>{g === "capital" ? "Capital" : "Delivery and partnership"}</b>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {types.filter(t => PARTNER_TYPES[t].group === g).map(t => { const reach = reachOf(project.country, PARTNER_TYPES[t].reach);
          return <form key={t} action={startProjectScanAction}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="type" value={t} /><input type="hidden" name="back" value={backTo} />
            <button className={ui.miniBtn} type="submit" title={`${PARTNER_TYPES[t].note} Scope: ${reach.length ? reach.map(geoLabel).join(", ") : "worldwide"}.`}>{PARTNER_TYPES[t].label}</button></form>; })}
      </div></div>)}
    {latest.map(run => {
      const rows = results.filter(x => x.runId === run.id).sort((a, b) => (MATCH_RANK[a.match] ?? 3) - (MATCH_RANK[b.match] ?? 3) || b.criteria.filter(c => c.result === "supported").length - a.criteria.filter(c => c.result === "supported").length || a.name.localeCompare(b.name));
      const active = run.status === "queued" || run.status === "running";
      return <div key={run.id} style={{ marginTop: 16 }}>
        <p><b>{labelOf(run.presetName)}</b> <span className={ui.sub}>{run.status} · {run.createdAt.slice(0, 10)} · {rows.length} candidate(s) · <Link href={`/scans/${run.id}`}>review all</Link></span></p>
        {active && <ScanProgress id={run.id} />}
        {rows.length === 0 ? <p className={r.empty}>{active ? "Searching…" : "No candidates with evidence. Try another partner type, or widen the scope from the scan launcher."}</p> :
          <table className={ui.table}><thead><tr><th>Organization</th><th>Fit</th><th>Evidence</th><th>Review</th></tr></thead><tbody>
            {rows.slice(0, 12).map(x => { const sup = x.criteria.filter(c => c.result === "supported"), con = x.criteria.filter(c => c.result === "contradicted");
              return <tr key={x.id}><td><Link href={`/companies/${x.entityId}`}><b>{x.name}</b></Link><div className={ui.sub}>{x.outcome === "new" ? "New to your network" : "Already in your network"}</div></td>
                <td><span className={`${ui.chip} ${x.match === "matches" ? ui.chipReed : x.match === "partial" ? ui.chipPollen : ui.chipMuted}`}>{x.match === "matches" ? "Strong fit" : x.match === "partial" ? "Partial fit" : "Unconfirmed"}</span></td>
                <td className={ui.sub}>{sup.slice(0, 3).map(c => c.label).join(" · ") || "—"}{con.length ? <><br />Against: {con.slice(0, 2).map(c => c.label).join(" · ")}</> : null}{x.sourceUrl ? <><br /><a href={x.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</td>
                <td className={ui.sub}>{x.review === "accepted" ? "Accepted" : x.review === "rejected" ? "Rejected" : "To review"}</td></tr>; })}
          </tbody></table>}
      </div>;
    })}
    <p className={ui.sub} style={{ marginTop: 12 }}>Qualified partners also appear under <Link href={`/projects/${project.id}?tab=matches`}>Matches</Link> once their role is recorded; public institutions are listed there without a scan.</p>
  </section>;
}

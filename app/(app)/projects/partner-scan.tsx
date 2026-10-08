// Partner scan panel (2026-10-08): from a project, launch a scan for capital or delivery partners. The preset is built
// from the project and opened in the scan launcher for review (sources, cost, criteria) before anything runs.
import Link from "next/link";
import { and, desc, eq, like } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { scanRuns, type projects } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { PARTNER_TYPES, reachOf, type PartnerType } from "@/lib/scan/project-scan";
import { geoLabel } from "@/lib/scan/countries";
import { startProjectScanAction } from "../project-scan-actions";

type Project = typeof projects.$inferSelect;

export default async function PartnerScanPanel({ project, group }: { project: Project; group?: "capital" | "delivery" }) {
  const types = (Object.keys(PARTNER_TYPES) as PartnerType[]).filter(k => !group || PARTNER_TYPES[k].group === group);
  const runs = await appDb().select({ id: scanRuns.id, presetName: scanRuns.presetName, status: scanRuns.status, createdAt: scanRuns.createdAt })
    .from(scanRuns).where(and(eq(scanRuns.mandateId, project.mandateId), like(scanRuns.presetName, `${project.name.slice(0, 100)}:%`))).orderBy(desc(scanRuns.createdAt)).limit(8);
  const groups = (["capital", "delivery"] as const).filter(g => types.some(t => PARTNER_TYPES[t].group === g));
  return <section className={r.panel}>
    <p className={r.panelTitle}>Scan for {group === "capital" ? "capital partners" : group === "delivery" ? "delivery partners" : "partners"}</p>
    <p className={ui.sub}>Find organizations that fit this project, built from its country, technology, size and stage. You review the scope and cost before it runs; results need review and nobody is contacted.</p>
    {groups.map(g => <div key={g} style={{ marginTop: 10 }}>
      {!group && <b>{g === "capital" ? "Capital" : "Delivery and partnership"}</b>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {types.filter(t => PARTNER_TYPES[t].group === g).map(t => { const reach = reachOf(project.country, PARTNER_TYPES[t].reach);
          return <form key={t} action={startProjectScanAction}><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="type" value={t} />
            <button className={ui.miniBtn} type="submit" title={`${PARTNER_TYPES[t].note} Scope: ${reach.length ? reach.map(geoLabel).join(", ") : "worldwide"}.`}>{PARTNER_TYPES[t].label}</button></form>; })}
      </div></div>)}
    {runs.length > 0 && <><p className={ui.sub} style={{ marginTop: 12 }}><b>Scans for this project</b></p>
      <ul className={ui.sub}>{runs.map(x => <li key={x.id}><Link href={`/scans/${x.id}`}>{x.presetName.replace(`${project.name}: `, "")}</Link> · {x.status} · {x.createdAt.slice(0, 10)}</li>)}</ul></>}
    <p className={ui.sub}>Qualified results appear under <Link href={`/projects/${project.id}?tab=matches`}>Matches</Link> once their role is recorded. Public institutions are also listed there without a scan.</p>
  </section>;
}

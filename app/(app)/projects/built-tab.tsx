// Project 360 → Development → Built environment (built environment §8–9). Server component: the site profile the fit
// engine used, the recommended solution stack by category, and the actions (shortlist, RFI, partnership).
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { beMatches, organizations, projects, projectScreeningFlags, siteIntelRuns } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { siteProfile } from "@/lib/built/fit";
import { CLIMATES, EFFECT, HAZARDS, MATCH_CONFIDENCE, PROJECT_TYPES, STACK_CATEGORIES } from "@/lib/built/vocab";
import { matchStatusAction, rfiFromMatchAction, runBuiltAction } from "../built-actions";
import s from "../intelligence/built/built.module.css";

export default async function BuiltTab({ projectId }: { projectId: string }) {
  const db = appDb();
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  const [run] = await db.select().from(siteIntelRuns).where(and(eq(siteIntelRuns.projectId, projectId), inArray(siteIntelRuns.status, ["complete", "partial"]))).orderBy(desc(siteIntelRuns.createdAt)).limit(1);
  const flags = (await db.select({ flag: projectScreeningFlags.flag }).from(projectScreeningFlags).where(and(eq(projectScreeningFlags.projectId, projectId), eq(projectScreeningFlags.status, "open")))).map(f => f.flag);
  const site = siteProfile(p, run ? run.stages.flatMap(x => x.facts ?? []) : [], flags);
  const matches = await db.select().from(beMatches).where(eq(beMatches.projectId, projectId)).orderBy(beMatches.rank);
  const provIds = [...new Set(matches.flatMap(m => m.providerOrgIds))];
  const orgs = provIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, provIds.slice(0, 90))) : [];
  const orgName = new Map(orgs.map(o => [o.id, o.name]));
  const back = `/projects/${projectId}?tab=built`;
  const lab = (o: Record<string, string>, k: string | undefined) => (k && k in o ? o[k] : "Unknown");
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Built environment intelligence</span><form action={runBuiltAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} /><button className="btn btn--primary" type="submit">{matches.length ? "Re-run" : "Run built environment intelligence"}</button></form></p>
        <dl className={r.kv}>
          <dt>Development type</dt><dd>{site.projectType ? PROJECT_TYPES[site.projectType] : "Not inferred: set the asset class"}</dd>
          <dt>Climate</dt><dd>{site.climate ? CLIMATES[site.climate] : "Unknown"} <span className={ui.sub}>{site.climateBasis}</span></dd>
          <dt>Hazards</dt><dd>{site.hazards.length ? site.hazards.map(h => HAZARDS[h]).join(", ") : "None identified"} <span className={ui.sub}>{site.hazardBasis.join("; ")}</span></dd>
          <dt>Site intelligence</dt><dd>{run ? `Run ${(run.finishedAt ?? run.updatedAt).slice(0, 10)}` : <>None yet: <Link href={`/map?project=${projectId}`}>run it in Atlas</Link> for climate and hazard facts</>}</dd>
        </dl>
        <p className={ui.sub}>Covers site, design (passive / bioclimatic), construction, materials, energy, water, digital and resilience. Local construction conditions, logistics, labor and contractor capacity come from the recorded companies and suppliers; where none are recorded the stack says so.</p>
      </section>
      {matches.length === 0 ? <p className={r.empty}>No recommendations yet.</p> : (
        <div className={s.stack}>{Object.keys(STACK_CATEGORIES).filter(c => matches.some(m => m.category === c)).map(c => (
          <section key={c}><h3>{STACK_CATEGORIES[c as keyof typeof STACK_CATEGORIES]}</h3>
            <ol>{matches.filter(m => m.category === c && m.status !== "rejected").map(m => (
              <li key={m.id}><b>{m.label.replace("DEMO — ", "")}</b> <span className={ui.chip}>{MATCH_CONFIDENCE[m.confidence as keyof typeof MATCH_CONFIDENCE]}</span>{m.status === "shortlisted" && <span className={ui.chip}>Shortlisted</span>}
                <span className={ui.sub} style={{ display: "block" }}>Why: {m.reason}</span>
                <span className={ui.sub} style={{ display: "block" }}>Cost {lab(EFFECT, m.impacts.cost)} · schedule {lab(EFFECT, m.impacts.schedule)} · carbon {lab(EFFECT, m.impacts.carbon)} · resilience {m.impacts.resilience === "lower" ? "risk reduced" : lab(EFFECT, m.impacts.resilience)} · {m.stageFit}</span>
                {m.providerOrgIds.length > 0 && <span className={ui.sub} style={{ display: "block" }}>Provider options: {m.providerOrgIds.map(o => <Link key={o} href={`/intelligence/built?tab=companies&open=${o}`}>{(orgName.get(o) ?? "").replace("DEMO — ", "")} </Link>)}</span>}
                <span className={ui.rowActions} style={{ marginTop: 4 }}>
                  {m.status !== "shortlisted" && <form action={matchStatusAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="shortlisted" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Shortlist</button></form>}
                  <form action={matchStatusAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="rejected" /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Not a fit</button></form>
                  {m.subjectType !== "strategy" && <form action={rfiFromMatchAction}><input type="hidden" name="id" value={m.id} /><button className={ui.miniBtn} type="submit">Open RFI</button></form>}
                </span>
              </li>
            ))}</ol>
          </section>
        ))}</div>
      )}
      <p className={ui.sub}>Confidence reflects climate, building-type and hazard fit and technology maturity. It is not a probability, and no sustainability claim is implied: see each company&apos;s recorded claims.</p>
    </>
  );
}

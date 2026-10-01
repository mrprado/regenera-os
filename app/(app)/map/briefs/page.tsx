import Link from "next/link";
import { and, asc, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { Map as MapIcon } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { BRIEF_TEMPLATES, briefsFor } from "@/lib/briefs";
import { appDb } from "@/lib/db/scoped";
import { createBriefAction } from "../../brief-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site briefs" };

/** Atlas Site Diagram Studio: annotated, comparable, exportable 2D site briefs on projects. */
export default async function BriefsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/map/briefs");
  const sp = await searchParams;
  const ids = user.scope.mandateIds.length ? user.scope.mandateIds : ["-"];
  const [briefs, located] = await Promise.all([
    briefsFor(appDb(), user.scope.mandateIds),
    appDb().select({ id: projects.id, name: projects.name }).from(projects).where(and(inArray(projects.mandateId, ids), isNull(projects.archivedAt), or(isNotNull(projects.geometry), and(isNotNull(projects.lat), isNotNull(projects.lng))))).orderBy(asc(projects.name)).limit(500),
  ]);
  return (
    <>
      <PageHeader title="Site briefs" actions={<Link className="btn" href="/map">Open Atlas</Link>} />
      <p className={ui.sub} style={{ marginTop: -4, maxWidth: 820 }}>Annotated site diagrams for diagnostics, proposals, decision memos and client meetings. Each annotation states whether it is measured, modeled, conceptual, field-observed or an open question, and what it rests on. A diagram is an input to analysis, not an engineering, energy-yield or legal finding.</p>
      <Notice text={sp.notice} />
      <div className={r.grid}>
        <div>
          {briefs.length === 0 ? <EmptyState icon={MapIcon} title="No site briefs yet" body="Create one from a project with a location: it starts from the project's boundary or point and its sourced context layers." /> : (
            <div className={ui.tableWrap}><table className={ui.table}>
              <thead><tr><th>Brief</th><th>Template</th><th>Version</th><th>Review</th><th>Updated</th></tr></thead>
              <tbody>{briefs.map(b => <tr key={b.id}><td className={ui.primary}><Link href={`/map/briefs/${b.id}`}>{b.title}</Link><span className={ui.sub}>{b.annotations.length} annotations · {b.scenarios.length} scenarios</span></td><td>{BRIEF_TEMPLATES[b.template as keyof typeof BRIEF_TEMPLATES]?.label ?? b.template}</td><td>v{b.version}</td><td><span className={ui.chip}>{b.reviewStatus.replace("_", " ")}</span></td><td className={ui.sub}>{b.updatedAt.slice(0, 10)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Create a site brief</p>
            {located.length === 0 ? <p className={r.empty}>No project has a location yet. Add a point or boundary on a project first.</p> : (
              <form action={createBriefAction} className={r.form} style={{ display: "grid", gap: 6 }}>
                <label className={ui.sub}>Project<select name="projectId" required defaultValue={sp.project ?? ""}><option value="" disabled>Choose</option>{located.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className={ui.sub}>Template<select name="template" defaultValue="diagnostic">{Object.entries(BRIEF_TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></label>
                <ul className={ui.sub} style={{ paddingLeft: 16, margin: 0 }}>{Object.values(BRIEF_TEMPLATES).map(t => <li key={t.label}><b>{t.label}:</b> {t.purpose}</li>)}</ul>
                <button className="btn btn--primary" type="submit">Create brief</button>
              </form>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

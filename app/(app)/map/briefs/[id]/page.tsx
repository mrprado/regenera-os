import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { decisions, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { BRIEF_TEMPLATES, KIND_LABEL, scopedBrief } from "@/lib/briefs";
import { appDb, isOwner } from "@/lib/db/scoped";
import { addScenarioAction, newBriefVersionAction, saveBriefMetaAction, setBriefReviewAction } from "../../../brief-actions";
import { BriefCanvas } from "./brief-canvas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site brief" };

const ACCURACY = { boundary: "Recorded site boundary", point: "Recorded point (no boundary)", approximate: "Approximate location", country: "Country-level only" } as const;

export default async function BriefPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/map/briefs/${id}`);
  const sp = await searchParams;
  const b = await scopedBrief(appDb(), user.scope.mandateIds, id).catch(() => null);
  if (!b) notFound();
  const [project] = b.projectId ? await appDb().select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, b.projectId)) : [];
  const decs = b.projectId ? await appDb().select({ id: decisions.id, title: decisions.title }).from(decisions).where(eq(decisions.projectId, b.projectId)).limit(100) : [];
  const t = BRIEF_TEMPLATES[b.template as keyof typeof BRIEF_TEMPLATES] ?? BRIEF_TEMPLATES.diagnostic;
  const editable = b.reviewStatus !== "approved";
  const kinds = [...t.kinds] as string[];
  const kindLabels = Object.fromEntries(kinds.map(k => [k, KIND_LABEL(k)]));
  const owner = isOwner(user.scope, b.mandateId);
  return (
    <>
      <PageHeader title={b.title} actions={<><Link className="btn" href="/map/briefs">All briefs</Link>{project && <Link className="btn" href={`/map?project=${project.id}`}>Open in Atlas</Link>}</>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -4 }}>{t.label} · v{b.version}{b.previousId ? <> (previous: <Link href={`/map/briefs/${b.previousId}`}>v{b.version - 1}</Link>)</> : null} · {b.reviewStatus.replace("_", " ")}{b.reviewedBy ? ` by ${b.reviewedBy}` : ""} · author {b.author} · {project ? <Link href={`/projects/${project.id}`}>{project.name}</Link> : "no project"} · {b.crs} · location: {ACCURACY[b.locationAccuracy]}</p>
      <div className={r.grid}>
        <div>
          <BriefCanvas briefId={b.id} editable={editable} center={{ lat: b.centerLat, lng: b.centerLng }} zoom={b.zoom} rings={b.rings} boundary={b.boundary} annotations={b.annotations} scenarios={b.scenarios} kinds={kinds} kindLabels={kindLabels} />
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Review</p>
            <div className={ui.rowActions}>
              {b.reviewStatus === "draft" && <form action={setBriefReviewAction}><input type="hidden" name="briefId" value={b.id} /><input type="hidden" name="to" value="in_review" /><button className={ui.miniBtn} type="submit">Send for review</button></form>}
              {b.reviewStatus === "in_review" && owner && <form action={setBriefReviewAction}><input type="hidden" name="briefId" value={b.id} /><input type="hidden" name="to" value="approved" /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Approve</button></form>}
              {b.reviewStatus === "in_review" && <form action={setBriefReviewAction}><input type="hidden" name="briefId" value={b.id} /><input type="hidden" name="to" value="draft" /><button className={ui.miniBtn} type="submit">Back to draft</button></form>}
              <form action={newBriefVersionAction}><input type="hidden" name="briefId" value={b.id} /><button className={ui.miniBtn} type="submit">New version</button></form>
            </div>
            {!editable && <p className={ui.sub}>Approved versions are locked; changes go into a new version.</p>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Scenarios</p>
            <ul className={r.timeline}>{b.scenarios.map(s => <li key={s.id}><span className={r.when}>{s.name}</span><span className={ui.sub}>{s.assumptions || "No assumptions recorded"}</span></li>)}</ul>
            {editable && <form action={addScenarioAction} className={r.form} style={{ display: "grid", gap: 6 }}><input type="hidden" name="briefId" value={b.id} /><input name="name" placeholder="Option B: northern access" aria-label="Scenario name" required /><textarea name="assumptions" rows={2} placeholder="Assumptions that differ" aria-label="Scenario assumptions" /><button className={ui.miniBtn} type="submit">Add scenario</button></form>}
            <p className={ui.sub}>All scenarios share this boundary, scale and rings, so they compare like for like.</p>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Context layers and sources</p>
            {b.layers.length === 0 ? <p className={r.empty}>No sourced place facts on the project yet. Run the project&apos;s place profile to add context.</p> : <ul className={ui.sub} style={{ paddingLeft: 16 }}>{b.layers.map(l => <li key={l.key}>{l.label} · {l.tier} · observed {l.observedAt ?? "unknown"}</li>)}</ul>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Assumptions, rings and decision</p>
            <form action={saveBriefMetaAction} className={r.form} style={{ display: "grid", gap: 6 }}>
              <input type="hidden" name="briefId" value={b.id} />
              <label className={ui.sub}>Assumptions<textarea name="assumptions" rows={4} defaultValue={b.assumptions} disabled={!editable} /></label>
              <label className={ui.sub}>Distance rings (km, comma separated)<input name="rings" defaultValue={b.rings.join(", ")} disabled={!editable} /></label>
              <label className={ui.sub}>Informs decision<select name="decisionId" defaultValue={b.decisionId ?? ""} disabled={!editable}><option value="">Not linked</option>{decs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
              {editable && <button className={ui.miniBtn} type="submit">Save</button>}
            </form>
            <p className={ui.sub}>Sun and shadow views and 3D massing come next; a shadow view will be a screening visual, never an energy-yield result.</p>
          </section>
        </aside>
      </div>
    </>
  );
}

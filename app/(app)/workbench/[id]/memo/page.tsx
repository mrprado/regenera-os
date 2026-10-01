import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { analysisRequests, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { loadRequest, memo } from "@/lib/workbench/engine";
import { CONCLUSIONS, CONFIDENCE, CONFIDENTIALITY, EVIDENCE_CLASSES, FINDING_KINDS, IC_STATUSES, OUTPUT_FORMATS, SEVERITY } from "@/lib/workbench/vocab";
import s from "./memo.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Memo" };

// The decision memo assembled from the analysis: every finding carries its numbered sources; nothing is added that
// the analysis does not contain. Print or save as PDF from the browser.
export default async function MemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireOsUser(`/workbench/${id}`);
  const db = appDb();
  const [own] = await db.select({ id: analysisRequests.id }).from(analysisRequests).where(and(eq(analysisRequests.id, id), mandateCondition(user.scope, analysisRequests.mandateId)));
  if (!own) notFound();
  const d = (await loadRequest(db, id))!;
  const { r } = d;
  const [project] = r.projectId ? await db.select({ name: projects.name }).from(projects).where(eq(projects.id, r.projectId)) : [];
  const m = memo(d);
  const flags = m.findings.filter(f => f.kind === "red_flag");
  const rest = m.findings.filter(f => f.kind !== "red_flag");
  const status = r.approvedBy ? `Approved by ${r.approvedBy} on ${r.approvedAt?.slice(0, 10)}` : r.reviewedBy ? `Reviewed by ${r.reviewedBy}; not yet approved` : r.preparedBy ? `Prepared by ${r.preparedBy}; awaiting review` : "DRAFT — not reviewed";
  return (
    <article className={s.doc} data-fullbleed>
      <nav className={s.tools}><Link href={`/workbench/${r.id}`}>← Back to the analysis</Link><span>Use your browser&apos;s print to save a PDF.</span></nav>
      <header className={s.cover}>
        <p className={s.brand}>REGENERA</p>
        <p className={s.meta}>{OUTPUT_FORMATS[r.outputFormat]}{project ? ` · ${project.name}` : ""} · {CONFIDENTIALITY[r.confidentiality]} · version {r.version} · {new Date().toISOString().slice(0, 10)}</p>
        <h1>{r.question}</h1>
        {r.decision && <p className={s.lede}>Decision informed: {r.decision}</p>}
        <p className={s.status} data-draft={!r.approvedBy}>{status}{r.icStatus !== "none" ? ` · Investment committee: ${IC_STATUSES[r.icStatus]}` : ""}</p>
      </header>

      <section><h2>Executive summary</h2>{r.summary ? <p>{r.summary}</p> : <p className={s.missing}>Not written.</p>}</section>
      <section><h2>Recommendation</h2>{r.recommendation ? <p className={s.rec}>{r.recommendation}</p> : <p className={s.missing}>Not written.</p>}{r.conclusion && <p><b>Conclusion on record:</b> {r.conclusion}</p>}</section>

      {d.story.length > 0 && <section><h2>Storyline</h2><table className={s.table}><thead><tr><th>Observation</th><th>Implication</th><th>Recommendation</th><th>Action</th></tr></thead><tbody>{d.story.map(p => <tr key={p.id}><td>{p.observation}</td><td>{p.implication}</td><td>{p.recommendation}</td><td>{p.action}</td></tr>)}</tbody></table></section>}

      {flags.length > 0 && <section><h2>Red flags</h2><table className={s.table}><thead><tr><th>Finding</th><th>Implication</th><th>Severity</th><th>Resolution</th><th>Sources</th></tr></thead><tbody>
        {flags.map(f => <tr key={f.id}><td>{f.finding}</td><td>{f.implication}</td><td>{SEVERITY[f.severity]}</td><td>{f.resolution}</td><td className={s.cite}>{f.cites.map(n => `[${n}]`).join(" ") || "—"}</td></tr>)}</tbody></table></section>}

      <section><h2>Findings</h2>{rest.length === 0 ? <p className={s.missing}>None recorded.</p> : <ol className={s.findings}>{rest.map(f => <li key={f.id}>
        <p><span className={s.kind}>{FINDING_KINDS[f.kind]}</span> {f.finding} <span className={s.cite}>{f.cites.map(n => `[${n}]`).join(" ")}</span></p>
        {f.implication && <p className={s.sub}>Implication: {f.implication}</p>}
        {f.assumptions && <p className={s.sub}>Assumptions: {f.assumptions}</p>}
        <p className={s.sub}>Confidence: {CONFIDENCE[f.confidence]} · prepared by {f.preparedBy}{f.reviewedBy ? ` · reviewed by ${f.reviewedBy}` : ""}</p>
      </li>)}</ol>}</section>

      {m.hypotheses.length > 0 && <section><h2>Hypotheses tested</h2><table className={s.table}><thead><tr><th>Hypothesis</th><th>Conclusion</th><th>Confidence</th><th>Rationale</th></tr></thead><tbody>
        {m.hypotheses.map(h => <tr key={h.id}><td>{h.text}</td><td>{h.conclusion ? CONCLUSIONS[h.conclusion] : "Open"}</td><td>{CONFIDENCE[h.confidence]}</td><td>{h.rationale}</td></tr>)}</tbody></table></section>}

      <section><h2>Outstanding questions</h2>{m.open.length === 0 ? <p>None.</p> : <ul>{m.open.map(n => <li key={n.id}>{n.text}</li>)}</ul>}</section>

      {(r.icConditions || r.icFollowUps || r.icRationale) && <section><h2>Investment committee</h2><p>{r.icRationale}</p>{r.icConditions && <p><b>Conditions:</b> {r.icConditions}</p>}{r.icFollowUps && <p><b>Follow-ups:</b> {r.icFollowUps}</p>}</section>}

      <section className={s.sources}><h2>Sources</h2>{m.sources.length === 0 ? <p className={s.missing}>No evidence recorded.</p> : <ol>{m.sources.map(({ n, e }) => <li key={e.id} value={n}>
        {e.title}{e.source ? `. ${e.source}` : ""}{e.sourceDate ? `, ${e.sourceDate}` : ""}{e.page ? `, p. ${e.page}` : ""}. <i>{EVIDENCE_CLASSES[e.evidenceClass].label}</i>{e.sourceUrl ? <> · <a href={e.sourceUrl}>{e.sourceUrl}</a></> : null}
      </li>)}</ol>}</section>
      <footer className={s.foot}>Prepared in Regenera OS. Facts carry their sources; inferences and recommendations are labelled. {r.approvedBy ? "" : "This memo is not approved."}</footer>
    </article>
  );
}

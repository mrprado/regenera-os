import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import ui from "@/components/ui.module.css";
import { analysisRequests, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { RISK_CATEGORIES } from "@/lib/projects/vocab";
import { loadRequest, memo, signOffGaps } from "@/lib/workbench/engine";
import {
  CONCLUSIONS, CONFIDENCE, EVIDENCE_CLASSES, EVIDENCE_KINDS, FINDING_KINDS, IC_NEXT, IC_STATUSES, MODES, NODE_KINDS, NODE_STATUSES, RELIABILITY, REQUEST_STATUSES, REVIEW_MARKS, SEVERITY,
} from "@/lib/workbench/vocab";
import {
  addEvidenceAction, addFindingAction, addNodeAction, addStoryAction, concludeNodeAction, convertFindingAction, icAction, markAction, resolveMarkAction, saveSynthesisAction, signOffAction,
} from "../../workbench-actions";
import s from "../workbench.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analysis" };

const PIPE: (keyof typeof REQUEST_STATUSES)[] = ["open", "workplan", "evidence", "analysis", "synthesis", "review", "approved", "decided"];

export default async function AnalysisPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/workbench/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [own] = await db.select({ id: analysisRequests.id }).from(analysisRequests).where(and(eq(analysisRequests.id, id), mandateCondition(user.scope, analysisRequests.mandateId)));
  if (!own) notFound();
  const d = (await loadRequest(db, id))!;
  const { r, nodes, evidence, findings, story, marks } = d;
  const [project] = r.projectId ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, r.projectId)) : [];
  const m = memo(d);
  const cite = new Map(m.sources.map(x => [x.e.id, x.n]));
  const gaps = signOffGaps(d);
  const openMarks = marks.filter(x => x.status === "open");
  const hidden = <input type="hidden" name="requestId" value={r.id} />;
  const nodeOpts = nodes.map(n => <option key={n.id} value={n.id}>{n.parentId ? "  · " : ""}{n.text.slice(0, 70)}</option>);
  const at = PIPE.indexOf(r.status === "closed" ? "decided" : r.status);
  const marksFor = (type: string, tid: string) => openMarks.filter(x => x.targetType === type && x.targetId === tid);

  const tree = (parent: string | null): React.ReactNode => {
    const kids = nodes.filter(n => n.parentId === parent);
    if (!kids.length) return null;
    return <ul className={s.tree}>{kids.map(n => {
      const ev = evidence.filter(e => e.nodeId === n.id);
      return <li key={n.id} data-kind={n.kind} data-status={n.status}>
        <details>
          <summary><span className={s.nodeText}>{n.kind === "hypothesis" ? "H · " : ""}{n.text}</span>
            <span className={s.nodeMeta}>{n.conclusion ? CONCLUSIONS[n.conclusion] : NODE_STATUSES[n.status]}{n.confidence !== "unknown" ? ` · ${CONFIDENCE[n.confidence]}` : ""}{ev.length ? ` · ${ev.length} ev.` : ""}{marksFor("node", n.id).length ? " · review" : ""}</span></summary>
          {n.rationale && <p className={s.small}>{n.rationale}</p>}
          <form action={concludeNodeAction} className={s.mini}>{hidden}<input type="hidden" name="nodeId" value={n.id} />
            <select name="status" defaultValue={n.status} aria-label="Status">{Object.entries(NODE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select name="conclusion" defaultValue={n.conclusion ?? ""} aria-label="Conclusion"><option value="">No conclusion</option>{Object.entries(CONCLUSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select name="confidence" defaultValue={n.confidence} aria-label="Confidence">{Object.entries(CONFIDENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="rationale" defaultValue={n.rationale} placeholder="Rationale" aria-label="Rationale" />
            <button className={ui.miniBtn} type="submit">Save</button></form>
        </details>
        {tree(n.id)}
      </li>;
    })}</ul>;
  };

  return (
    <>
      <header className={s.head}>
        <p className={s.kicker}>{MODES[r.mode].label}{project ? <> · <Link href={`/projects/${project.id}`}>{project.name}</Link></> : null} · v{r.version}{r.deadline ? ` · due ${r.deadline}` : ""} · <Link href="/workbench">All analyses</Link></p>
        <h1 className={s.question}>{r.question}</h1>
        {r.decision && <p className={s.decision}>Decision: {r.decision}</p>}
        <ol className={s.pipe} aria-label="Stage">{PIPE.map((k, i) => <li key={k} data-state={i < at ? "done" : i === at ? "now" : "todo"}>{REQUEST_STATUSES[k]}</li>)}</ol>
        <p className={s.small}>Analyst {r.owner ?? "—"} · reviewer {r.reviewer ?? "—"} · decision maker {r.decisionMaker ?? "—"} · prepared {r.preparedBy ?? "—"} · reviewed {r.reviewedBy ?? "—"} · approved {r.approvedBy ?? "—"} · <Link href={`/workbench/${r.id}/memo`}>Memo</Link></p>
      </header>
      <Notice text={sp.notice} />

      <div className={s.cols}>
        <aside className={s.left} id="tree">
          <p className={s.colTitle}>Issue tree</p>
          {nodes.length ? tree(null) : <p className={s.empty}>Break the question into sub-questions and hypotheses.</p>}
          <details className={s.add}><summary>Add question or hypothesis</summary>
            <form action={addNodeAction} className={s.stack}>{hidden}
              <select name="kind" defaultValue="hypothesis" aria-label="Kind">{Object.entries(NODE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select name="parentId" defaultValue="" aria-label="Under"><option value="">Top level</option>{nodeOpts}</select>
              <textarea name="text" required rows={2} placeholder="H1: Grid connection is the primary obstacle to financing" aria-label="Text" />
              <input name="evidenceRequired" placeholder="Evidence required" aria-label="Evidence required" />
              <button className={ui.miniBtn} type="submit">Add</button>
            </form></details>
        </aside>

        <main className={s.center}>
          <section id="findings">
            <p className={s.colTitle}>Findings <span>{findings.length}</span></p>
            {findings.length === 0 ? <p className={s.empty}>Record findings as you go: the fact, what it implies, how severe, how to resolve, and the evidence behind it.</p> : (
              <ol className={s.findings}>{m.findings.map(f => <li key={f.id} data-kind={f.kind} data-severity={f.severity}>
                <div className={s.fHead}><span className={s.fKind}>{FINDING_KINDS[f.kind]} · {SEVERITY[f.severity]} · {CONFIDENCE[f.confidence]}</span>
                  <span className={s.cites}>{f.cites.length ? f.cites.map(n => <sup key={n}>[{n}]</sup>) : f.kind === "recommendation" || f.kind === "inference" ? null : <em>no evidence</em>}</span></div>
                <p className={s.fText}>{f.finding}</p>
                {f.implication && <p className={s.small}><b>Implication</b> {f.implication}</p>}
                {f.resolution && <p className={s.small}><b>Resolution</b> {f.resolution}</p>}
                {f.assumptions && <p className={s.small}><b>Assumptions</b> {f.assumptions}</p>}
                <p className={s.small}>Prepared by {f.preparedBy}{f.reviewedBy ? ` · reviewed by ${f.reviewedBy}` : ""}{f.action ? ` · became ${f.action.split(":")[0]}` : ""}</p>
                {marksFor("finding", f.id).map(x => <p key={x.id} className={s.mark}>{REVIEW_MARKS[x.mark]} — {x.comment} ({x.author})</p>)}
                <div className={s.row}>
                  {!f.action && <>
                    <form action={convertFindingAction}>{hidden}<input type="hidden" name="findingId" value={f.id} /><input type="hidden" name="to" value="task" /><button className={ui.miniBtn} type="submit">Task</button></form>
                    {r.projectId && <form action={convertFindingAction} className={s.row}>{hidden}<input type="hidden" name="findingId" value={f.id} /><input type="hidden" name="to" value="risk" /><select name="riskCategory" aria-label="Risk category" defaultValue="">{[<option key="" value="" disabled>Risk category…</option>, ...Object.entries(RISK_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)]}</select><button className={ui.miniBtn} type="submit">Risk</button></form>}
                    {r.projectId && <form action={convertFindingAction}>{hidden}<input type="hidden" name="findingId" value={f.id} /><input type="hidden" name="to" value="decision" /><button className={ui.miniBtn} type="submit">Decision</button></form>}
                  </>}
                  <details className={s.inlineDetails}><summary>Review comment</summary><form action={markAction} className={s.row}>{hidden}<input type="hidden" name="targetType" value="finding" /><input type="hidden" name="targetId" value={f.id} /><select name="mark" aria-label="Mark">{Object.entries(REVIEW_MARKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="comment" placeholder="Comment" aria-label="Comment" /><button className={ui.miniBtn} type="submit">Add</button></form></details>
                </div>
              </li>)}</ol>)}
            <details className={s.add}><summary>Record a finding</summary>
              <form action={addFindingAction} className={s.grid2}>{hidden}
                <select name="kind" defaultValue="finding" aria-label="Kind">{Object.entries(FINDING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="severity" defaultValue="medium" aria-label="Severity">{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <textarea className={s.full} name="finding" required rows={2} placeholder="No executed PPA." aria-label="Finding" />
                <input className={s.full} name="implication" placeholder="Implication: revenue remains uncontracted" aria-label="Implication" />
                <input className={s.full} name="resolution" placeholder="Resolution: secure a term sheet before the raise" aria-label="Resolution" />
                <input name="assumptions" placeholder="Assumptions" aria-label="Assumptions" />
                <select name="confidence" defaultValue="preliminary" aria-label="Confidence">{Object.entries(CONFIDENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="nodeId" defaultValue="" aria-label="Question"><option value="">Question (optional)</option>{nodeOpts}</select>
                <fieldset className={`${s.full} ${s.evPick}`}><legend>Evidence</legend>{evidence.length ? evidence.map(e => <label key={e.id}><input type="checkbox" name="evidenceIds" value={e.id} />[{cite.get(e.id)}] {e.title}</label>) : <span className={s.small}>Add evidence on the right first.</span>}</fieldset>
                <button className={ui.miniBtn} type="submit">Record</button>
              </form></details>
          </section>

          <section id="synthesis">
            <p className={s.colTitle}>Synthesis</p>
            <form action={saveSynthesisAction} className={s.stack}>{hidden}
              <label className={s.lbl}>Executive summary<textarea name="summary" rows={4} defaultValue={r.summary} placeholder="Strong resource quality is offset by a weak interconnection position; grid access, not resource, is the binding development constraint." /></label>
              <label className={s.lbl}>Recommendation<textarea name="recommendation" rows={2} defaultValue={r.recommendation} placeholder="Advance grid diligence before increasing development spend." /></label>
              <button className={ui.miniBtn} type="submit">Save synthesis</button>
            </form>
            <p className={s.colTitle}>Storyline <span>observation → implication → recommendation → action</span></p>
            {story.length > 0 && <ol className={s.story}>{story.map(p => <li key={p.id}><b>{p.observation}</b>{p.implication && <span>→ {p.implication}</span>}{p.recommendation && <span>→ {p.recommendation}</span>}{p.action && <span>→ {p.action}</span>}</li>)}</ol>}
            <details className={s.add}><summary>Add storyline point</summary>
              <form action={addStoryAction} className={s.stack}>{hidden}
                <input name="observation" required placeholder="Observation: grid congestion is rising around the project" aria-label="Observation" />
                <input name="implication" placeholder="Implication" aria-label="Implication" /><input name="recommendation" placeholder="Recommendation" aria-label="Recommendation" /><input name="action" placeholder="Action" aria-label="Action" />
                <button className={ui.miniBtn} type="submit">Add</button>
              </form></details>
          </section>

          <section id="review">
            <p className={s.colTitle}>Review and sign-off</p>
            {r.mode === "quick" ? (
              r.status === "closed" ? <p className={s.small}>Closed by {r.approvedBy}: {r.conclusion}</p> :
              <form action={signOffAction} className={s.row}>{hidden}<input type="hidden" name="step" value="close" /><input name="conclusion" required placeholder="Conclusion" aria-label="Conclusion" /><button className="btn" type="submit">Close</button></form>
            ) : <>
              {gaps.length > 0 ? <ul className={s.gaps}>{gaps.map(g => <li key={g}>{g}</li>)}</ul> : !r.preparedBy && <p className={s.small}>Ready to prepare for review.</p>}
              {openMarks.length > 0 && <ul className={s.marks}>{openMarks.map(x => <li key={x.id}>{REVIEW_MARKS[x.mark]} — {x.comment} <span className={s.small}>({x.author}, {x.targetType})</span><form action={resolveMarkAction}>{hidden}<input type="hidden" name="markId" value={x.id} /><button className={ui.miniBtn} type="submit">Resolve</button></form></li>)}</ul>}
              <div className={s.row}>
                {!r.preparedBy || r.status === "synthesis" ? <form action={signOffAction}>{hidden}<input type="hidden" name="step" value="prepare" /><button className="btn" type="submit" disabled={gaps.length > 0}>Prepare for review</button></form> : null}
                {r.status === "review" && !r.reviewedBy && <form action={signOffAction}>{hidden}<input type="hidden" name="step" value="review" /><button className="btn" type="submit" disabled={r.preparedBy === user.email}>Mark reviewed</button></form>}
                {r.reviewedBy && !r.approvedBy && <form action={signOffAction} className={s.row}>{hidden}<input type="hidden" name="step" value="approve" /><input name="conclusion" required placeholder="Conclusion for the record" aria-label="Conclusion" /><button className="btn btn--primary" type="submit">Approve</button></form>}
              </div>
              {r.approvedBy && <p className={s.small}>Approved by {r.approvedBy} on {r.approvedAt?.slice(0, 10)}: {r.conclusion}{r.decisionId ? " · decision recorded on the project" : ""}</p>}
              <p className={s.small}>AI can gather and organise evidence; it is never the preparer, reviewer or approver.</p>
            </>}
          </section>

          <section id="ic">
            <p className={s.colTitle}>Investment committee <span>{IC_STATUSES[r.icStatus]}</span></p>
            {(r.icConditions || r.icRationale || r.icFollowUps) && <p className={s.small}>{[r.icRationale && `Rationale: ${r.icRationale}`, r.icConditions && `Conditions: ${r.icConditions}`, r.icFollowUps && `Follow-ups: ${r.icFollowUps}`].filter(Boolean).join(" · ")}</p>}
            {IC_NEXT[r.icStatus].length > 0 && <form action={icAction} className={s.row}>{hidden}
              <select name="to" aria-label="Move to">{IC_NEXT[r.icStatus].map(k => <option key={k} value={k}>{IC_STATUSES[k]}</option>)}</select>
              <input name="rationale" placeholder="Rationale (required for the outcome)" aria-label="Rationale" /><input name="conditions" placeholder="Conditions" aria-label="Conditions" /><input name="followUps" placeholder="Follow-ups" aria-label="Follow-ups" />
              <button className={ui.miniBtn} type="submit">Move</button></form>}
          </section>
        </main>

        <aside className={s.right} id="evidence">
          <p className={s.colTitle}>Evidence <span>{evidence.length}</span></p>
          {evidence.length === 0 ? <p className={s.empty}>Documents, datasets, quotes, map views, interviews, regulatory sources, model outputs.</p> : (
            <ol className={s.evidence}>{m.sources.map(({ n, e }) => <li key={e.id}>
              <span className={s.num}>[{n}]</span>
              <div><b>{e.title}</b>
                <span className={s.small}>{EVIDENCE_CLASSES[e.evidenceClass].label} · {EVIDENCE_KINDS[e.kind]} · reliability {RELIABILITY[e.reliability].toLowerCase()}{e.sourceDate ? ` · ${e.sourceDate}` : ""}</span>
                <span className={s.small}>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noreferrer">{e.source || "source"}</a> : e.source}{e.page ? `, p. ${e.page}` : ""}{e.mapView ? <> · <Link href={`/map#${e.mapView}`}>map view</Link></> : null}{e.documentId ? " · document" : ""}{e.claimId ? " · claim" : ""}</span>
                {e.excerpt && <q className={s.excerpt}>{e.excerpt}</q>}
                {e.nodeId && <span className={s.small}>→ {nodes.find(x => x.id === e.nodeId)?.text.slice(0, 60)}</span>}
              </div></li>)}</ol>)}
          <details className={s.add} open={evidence.length === 0}><summary>Add evidence</summary>
            <form action={addEvidenceAction} className={s.stack}>{hidden}
              <input name="title" required placeholder="Title" aria-label="Title" />
              <select name="evidenceClass" defaultValue="primary" aria-label="Evidence class">{Object.entries(EVIDENCE_CLASSES).map(([k, v]) => <option key={k} value={k}>{v.label} — {v.note}</option>)}</select>
              <select name="kind" defaultValue="document" aria-label="Kind">{Object.entries(EVIDENCE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input name="source" placeholder="Source (organization, author, system)" aria-label="Source" />
              <input name="sourceUrl" type="url" placeholder="Link" aria-label="Link" />
              <div className={s.row}><input name="sourceDate" type="date" aria-label="Source date" /><input name="page" placeholder="Page" aria-label="Page" style={{ width: 70 }} /></div>
              <textarea name="excerpt" rows={2} placeholder="Excerpt (short quote)" aria-label="Excerpt" />
              <input name="mapView" placeholder="Atlas view (paste the map URL hash)" aria-label="Atlas view" />
              <select name="nodeId" defaultValue="" aria-label="Answers question"><option value="">Answers question (optional)</option>{nodeOpts}</select>
              <select name="reliability" defaultValue="medium" aria-label="Reliability">{Object.entries(RELIABILITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className={ui.miniBtn} type="submit">Add</button>
            </form></details>
        </aside>
      </div>
    </>
  );
}

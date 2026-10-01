import Link from "next/link";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { analysisRequests, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { CONFIDENTIALITY, IC_STATUSES, MODES, OUTPUT_FORMATS, PRIORITIES, REQUEST_STATUSES, TEMPLATES } from "@/lib/workbench/vocab";
import { createAnalysisAction } from "../workbench-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analyst workbench" };

// QUESTION → ISSUE TREE → WORKPLAN → EVIDENCE → ANALYSIS → FINDINGS → SYNTHESIS → REVIEW → DECISION → ACTION.
export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/workbench");
  const sp = await searchParams;
  const db = appDb();
  const mine = sp.view === "mine";
  const [rows, projs] = await Promise.all([
    db.select({ a: analysisRequests, project: projects.name }).from(analysisRequests).leftJoin(projects, eq(projects.id, analysisRequests.projectId))
      .where(and(mandateCondition(user.scope, analysisRequests.mandateId), mine ? eq(analysisRequests.owner, user.email) : undefined)).orderBy(desc(analysisRequests.updatedAt)).limit(300),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Analyst workbench" count={rows.length} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ maxWidth: 860 }}>Every analysis starts from the decision it informs. Formal analyses need evidence behind each conclusion, a review by someone other than the analyst and a named approver; approval writes the project decision. Quick work skips the ceremony.</p>
      <nav className={ui.tabs} aria-label="Views"><Link className={`${ui.tab} ${mine ? "" : ui.tabActive}`} href="/workbench">All</Link><Link className={`${ui.tab} ${mine ? ui.tabActive : ""}`} href="/workbench?view=mine">Assigned to me</Link></nav>
      <div className={r.grid}>
        <section className={r.panel}>
          {rows.length === 0 ? <p className={r.empty}>No analyses yet.</p> : <table className={ui.table}>
            <thead><tr><th>Question</th><th>Stage</th><th>Mode</th><th>Owner</th><th>Due</th><th>IC</th></tr></thead>
            <tbody>{rows.map(({ a, project }) => <tr key={a.id}>
              <td className={ui.primary}><Link href={`/workbench/${a.id}`}>{a.question}</Link><span className={ui.sub}>{[project, OUTPUT_FORMATS[a.outputFormat], PRIORITIES[a.priority], CONFIDENTIALITY[a.confidentiality]].filter(Boolean).join(" · ")}</span></td>
              <td>{REQUEST_STATUSES[a.status]}</td><td className={ui.sub}>{MODES[a.mode].label}</td><td className={ui.sub}>{a.owner ?? "—"}</td>
              <td className={ui.sub} style={a.deadline && a.deadline < today && !["approved", "decided", "closed"].includes(a.status) ? { color: "var(--critical)" } : undefined}>{a.deadline ?? "—"}</td>
              <td className={ui.sub}>{a.icStatus === "none" ? "—" : IC_STATUSES[a.icStatus]}</td></tr>)}</tbody>
          </table>}
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>New analysis</p>
          <form action={createAnalysisAction} className={r.form}>
            <label>Question<textarea name="question" required rows={3} placeholder="Is Project X sufficiently advanced to begin institutional investor outreach?" /></label>
            <label>Decision it informs<input name="decision" placeholder="Start outreach now, or first close gaps?" /></label>
            <label>Structure<select name="template" defaultValue={sp.template ?? "capital_readiness"}>{Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <label>Mode<select name="mode" defaultValue="formal">{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            <label>Project<select name="projectId" defaultValue={sp.project ?? ""}><option value="">—</option>{projs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <div className={r.formRow}><label>Analyst<input name="owner" type="email" defaultValue={user.email} /></label><label>Reviewer<input name="reviewer" type="email" /></label></div>
            <div className={r.formRow}><label>Decision maker<input name="decisionMaker" /></label><label>Deadline<input name="deadline" type="date" /></label></div>
            <div className={r.formRow}><label>Output<select name="outputFormat" defaultValue="memo">{Object.entries(OUTPUT_FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Priority<select name="priority" defaultValue="normal">{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
            <label>Audience<input name="audience" placeholder="Investment committee" /></label>
            <label>Confidentiality<select name="confidentiality" defaultValue="internal">{Object.entries(CONFIDENTIALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Scope<textarea name="scope" rows={2} /></label>
            <button className="btn btn--primary" type="submit">Open analysis</button>
          </form></section></aside>
      </div>
    </>
  );
}

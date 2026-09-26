import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { capitalOpportunities, organizations, playbookCorrections, playbookRuns, playbooks, playbookVersions, projects } from "@/db/schema";
import { MATURITY } from "@/db/playbooks";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { repeatedCorrections } from "@/lib/playbooks/engine";
import { GOVERNANCE_LABEL, RUN_LABEL, SCOPE_LABEL } from "@/lib/playbooks/labels";
import { TOOLS } from "@/lib/playbooks/tools";
import { correctionAction, maturityAction, startRunAction, versionAction } from "../../playbook-actions";
import styles from "../../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playbook" };

export default async function PlaybookPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/playbooks");
  const { id } = await params;
  const sp = await searchParams;
  const db = appDb();
  const [p] = await db.select().from(playbooks).where(and(eq(playbooks.id, id), mandateCondition(user.scope, playbooks.mandateId)));
  if (!p) notFound();
  const [versions, runs, corrections, repeats] = await Promise.all([
    db.select().from(playbookVersions).where(eq(playbookVersions.playbookId, p.id)).orderBy(desc(playbookVersions.version)),
    db.select().from(playbookRuns).where(eq(playbookRuns.playbookId, p.id)).orderBy(desc(playbookRuns.updatedAt)).limit(20),
    db.select().from(playbookCorrections).where(eq(playbookCorrections.playbookId, p.id)).orderBy(desc(playbookCorrections.createdAt)).limit(30),
    repeatedCorrections(db, p.id),
  ]);
  const live = versions.find(v => v.version === p.currentVersion)!;
  const def = live.definition;
  const entities = p.entityType === "project" ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.mandateId, p.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name))
    : p.entityType === "organization" ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.mandateId, p.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000)
    : p.entityType === "capital_opportunity" ? await db.select({ id: capitalOpportunities.id, name: capitalOpportunities.title }).from(capitalOpportunities).where(eq(capitalOpportunities.mandateId, p.mandateId)) : [];
  const owner = isOwner(user.scope);

  return (
    <>
      <PageHeader title={p.name} actions={<Link className="btn" href="/playbooks">All playbooks</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -6 }}><span className={ui.chip}>{p.maturity}</span> version {p.currentVersion} · runs on {p.entityType.replace("_", " ")}</p>
      {repeats.length > 0 && <p className={ui.notice}>The same one-time correction has been made {repeats[0].n} times (&quot;{repeats[0].example}&quot;). Consider making it a permanent process rule.</p>}
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>Process</p>
            <dl className={r.kv}><dt>Purpose</dt><dd>{def.purpose}</dd><dt>When to use</dt><dd>{def.whenToUse}</dd><dt>Trigger</dt><dd>{def.trigger}</dd>{def.inputs.length > 0 && <><dt>Inputs</dt><dd>{def.inputs.join(" · ")}</dd></>}</dl>
            <ol style={{ margin: "8px 0 0 18px", fontSize: 13.5 }}>{def.steps.map(s => <li key={s.key} style={{ marginBottom: 4 }}>{s.title} <span className={ui.chip}>{GOVERNANCE_LABEL[s.governance]}</span>{s.tool ? <span className={ui.sub}> · tool {TOOLS[s.tool]?.label ?? s.tool}</span> : null}</li>)}</ol>
            {def.rules.length > 0 && <><p className={ui.sub}><b>Decision rules and edge cases</b></p><ul style={{ margin: "0 0 0 18px", fontSize: 13 }}>{def.rules.map(x => <li key={x.id}>{x.text}{x.origin ? <span className={ui.sub}> ({x.origin})</span> : null}</li>)}</ul></>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Toolbox</p>
            {def.toolbox.length === 0 ? <p className={r.empty}>No tools listed.</p> : <p style={{ fontSize: 13 }}>{def.toolbox.map(t => `${t.name} (${t.kind})`).join(" · ")}</p>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Proof: definition of done</p>
            <ul style={{ margin: "0 0 0 18px", fontSize: 13.5 }}>{def.proof.map(x => <li key={x.id}>{x.text} <span className={ui.sub}>({x.check.type === "manual" ? "a person confirms" : `checked: ${x.check.type.replace(/_/g, " ")}`})</span></li>)}</ul>
            {def.evidence.length > 0 && <p className={ui.sub}>Evidence: {def.evidence.join(" · ")}</p>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Governance</p>
            <dl className={r.kv}><dt>AI may execute</dt><dd>{def.governance.autonomous.join(", ") || "—"}</dd><dt>Human review</dt><dd>{def.governance.review.join(", ") || "—"}</dd><dt>Human approval</dt><dd>{def.governance.approval.join(", ") || "—"}</dd><dt>Restricted</dt><dd>{def.governance.restricted.join(", ") || "—"}</dd></dl>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Versions</p>
            <table className={ui.table}><tbody>{versions.map(v => (
              <tr key={v.id}><td>v{v.version} <span className={ui.chip}>{v.status}</span><span className={ui.sub} style={{ display: "block" }}>{v.changeNote} · proposed by {v.proposedBy}{v.approvedBy ? ` · approved by ${v.approvedBy}` : ""}</span></td>
                <td>{owner && v.status === "draft" && <>
                  <form action={versionAction} style={{ display: "inline" }}><input type="hidden" name="playbookId" value={p.id} /><input type="hidden" name="version" value={v.version} /><input type="hidden" name="decision" value="promote" /><button className={ui.miniBtn} type="submit">Approve</button></form>{" "}
                  <form action={versionAction} style={{ display: "inline" }}><input type="hidden" name="playbookId" value={p.id} /><input type="hidden" name="version" value={v.version} /><input type="hidden" name="decision" value="reject" /><button className={ui.miniBtn} type="submit">Reject</button></form>
                </>}</td></tr>
            ))}</tbody></table>
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Run</p>
            <form action={startRunAction} className={styles.stack}>
              <input type="hidden" name="playbookId" value={p.id} />
              {p.entityType !== "none" && <label>{p.entityType.replace("_", " ")}<select name="entityId" required defaultValue=""><option value="" disabled>Choose</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
              <button className="btn btn--primary" type="submit">Start run</button>
            </form>
            <ul className={r.timeline} style={{ marginTop: 10 }}>{runs.map(x => <li key={x.id}><span className={r.when}>{RUN_LABEL[x.status]}</span><span><Link href={`/playbooks/runs/${x.id}`}>{x.entityLabel || "Run"}</Link> · v{x.version} · {x.updatedAt.slice(0, 10)}</span></li>)}</ul>
          </section>
          {owner && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Maturity</p>
              <form action={maturityAction} className={styles.inline}><input type="hidden" name="playbookId" value={p.id} /><select name="maturity" defaultValue={p.maturity} aria-label="Maturity">{MATURITY.map(m => <option key={m} value={m}>{m}</option>)}</select><button className={ui.miniBtn} type="submit">Set</button></form>
              <p className={ui.sub}>Draft → Tested → Validated → Trusted → Automated. Changes to validated playbooks still go through approved versions.</p>
            </section>
          )}
          <section className={r.panel}>
            <p className={r.panelTitle}>Improve the playbook</p>
            <form action={correctionAction} className={styles.stack}>
              <input type="hidden" name="playbookId" value={p.id} />
              <label>What went wrong<textarea name="description" rows={2} required /></label>
              <label>Which layer failed<select name="layer"><option value="process">Process (steps, rules)</option><option value="toolbox">Toolbox (data, templates)</option><option value="proof">Proof (the check missed it)</option></select></label>
              <label>Fix as<select name="scope">{Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Change (rule text, tool or check)<input name="change" /></label>
              <button className="btn" type="submit">Record</button>
            </form>
            {corrections.length > 0 && <ul className={r.timeline} style={{ marginTop: 10 }}>{corrections.map(c => <li key={c.id}><span className={r.when}>{c.createdAt.slice(0, 10)}</span><span>{SCOPE_LABEL[c.scope]} ({c.failureLayer}): {c.description}{c.proposedVersion ? ` → v${c.proposedVersion}` : ""}</span></li>)}</ul>}
          </section>
        </aside>
      </div>
    </>
  );
}

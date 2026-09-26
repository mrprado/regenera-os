import { asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { playbookCorrections, playbookRuns, playbooks, playbookVersions } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { RUN_LABEL } from "@/lib/playbooks/labels";
import { seedPlaybooksAction } from "../playbook-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playbooks" };

export default async function PlaybooksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/playbooks");
  const sp = await searchParams;
  const db = appDb();
  const [list, runs, drafts, corrections] = await Promise.all([
    db.select().from(playbooks).where(mandateCondition(user.scope, playbooks.mandateId)).orderBy(asc(playbooks.name)),
    db.select({ r: playbookRuns, name: playbooks.name }).from(playbookRuns).innerJoin(playbooks, eq(playbooks.id, playbookRuns.playbookId)).where(mandateCondition(user.scope, playbookRuns.mandateId)).orderBy(desc(playbookRuns.updatedAt)).limit(40),
    db.select({ playbookId: playbookVersions.playbookId, n: sql<number>`count(*)` }).from(playbookVersions).where(eq(playbookVersions.status, "draft")).groupBy(playbookVersions.playbookId),
    db.select({ playbookId: playbookCorrections.playbookId, n: sql<number>`count(*)` }).from(playbookCorrections).where(mandateCondition(user.scope, playbookCorrections.mandateId)).groupBy(playbookCorrections.playbookId),
  ]);
  return (
    <>
      <PageHeader title="Playbooks" count={list.length} actions={list.length < 20 ? <form action={seedPlaybooksAction}><button className="btn btn--primary" type="submit">Add the standard library</button></form> : null} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -4 }}>Every repeated job as Process, Toolbox, Proof and Governance. &quot;Done&quot; is decided by checks against records; approval steps need a person; corrections become draft versions you approve.</p>
      <div className={r.grid}>
        <section className={r.panel}>
          <p className={r.panelTitle}>Library</p>
          {list.length === 0 ? <p className={r.empty}>No playbooks yet. Add the standard library (20 playbooks: intake, qualification, site intelligence, capital pathway, compliance screen …).</p> : (
            <table className={ui.table}><tbody>{list.map(p => {
              const d = drafts.find(x => x.playbookId === p.id)?.n ?? 0;
              const c = corrections.find(x => x.playbookId === p.id)?.n ?? 0;
              return <tr key={p.id}><td><Link href={`/playbooks/${p.id}`}><b>{p.name}</b></Link><span className={ui.sub} style={{ display: "block" }}>{p.key} · runs on {p.entityType.replace("_", " ")} · v{p.currentVersion}{d ? ` · ${d} draft version${d === 1 ? "" : "s"} to review` : ""}{c ? ` · ${c} correction${c === 1 ? "" : "s"}` : ""}</span></td><td><span className={ui.chip}>{p.maturity}</span></td></tr>;
            })}</tbody></table>
          )}
        </section>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Recent runs</p>
            {runs.length === 0 ? <p className={r.empty}>No runs yet. Start one from a playbook or from a project.</p> : (
              <ul className={r.timeline}>{runs.map(({ r: x, name }) => <li key={x.id}><span className={r.when} style={{ color: x.status === "needs_review" || x.status === "failed" ? "#b0432f" : undefined }}>{RUN_LABEL[x.status]}</span><span><Link href={`/playbooks/runs/${x.id}`}>{name}</Link>{x.entityLabel ? ` · ${x.entityLabel}` : ""} · {x.updatedAt.slice(0, 10)}</span></li>)}</ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

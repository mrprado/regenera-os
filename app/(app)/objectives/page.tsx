import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Crosshair } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { objectives, organizations, OBJECTIVE_KINDS, type ObjectiveKind } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { AUDIENCES } from "@/lib/scan/audiences";
import { saveObjectiveAction } from "../flow-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Objectives" };

/** Objectives: what a party (or Regenera) wants. Each one drives its own scan, shortlist and documents. */
export default async function ObjectivesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/objectives");
  const sp = await searchParams;
  const rows = await appDb().select({ o: objectives, org: organizations.name }).from(objectives).leftJoin(organizations, eq(organizations.id, objectives.orgId))
    .where(inArray(objectives.mandateId, user.scope.mandateIds.length ? user.scope.mandateIds : ["-"])).orderBy(desc(objectives.updatedAt)).limit(200);
  return (
    <>
      <PageHeader title="Objectives" count={rows.length} />
      <p className={ui.sub} style={{ marginTop: -4, maxWidth: 820 }}>Profile + objective → scan → qualify → match → generate → approve → execute. Create an objective on a party&apos;s record (Profile &amp; objectives tab), or here for Regenera&apos;s own business development.</p>
      <Notice text={sp.notice} />
      <div className={r.grid}>
        <div>
          {rows.length === 0 ? <EmptyState icon={Crosshair} title="No objectives yet" body="An EPC that wants contracts, a fund that wants projects, a developer that needs an EPC: each is an objective with its own criteria and shortlist." /> : (
            <div className={ui.tableWrap}><table className={ui.table}>
              <thead><tr><th>Objective</th><th>Party</th><th>Kind</th><th>Owner</th><th>Status</th></tr></thead>
              <tbody>{rows.map(({ o, org }) => (
                <tr key={o.id}>
                  <td className={ui.primary}><Link href={`/objectives/${o.id}`}>{o.title}</Link></td>
                  <td>{o.orgId ? <Link href={`/companies/${o.orgId}?tab=profile`}>{org}</Link> : "Regenera"}</td>
                  <td>{OBJECTIVE_KINDS[o.kind as ObjectiveKind] ?? o.kind}</td>
                  <td className={ui.sub}>{o.owner}</td>
                  <td><span className={ui.chip}>{o.status}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>New objective (Regenera&apos;s own)</p>
            <form action={saveObjectiveAction} className={r.form} style={{ display: "grid", gap: 6 }}>
              <label className={ui.sub}>Kind<select name="kind" defaultValue="find_clients">{Object.entries(OBJECTIVE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className={ui.sub}>Title<input name="title" required placeholder="Diagnostic clients: Mexico real-estate developers" /></label>
              <label className={ui.sub}>Audience to find<select name="targetAudience" defaultValue=""><option value="">Choose</option>{AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
              <label className={ui.sub}>Geography<input name="geography" placeholder="Mexico" /></label>
              <label className={ui.sub}>Capabilities / terms<input name="capabilities" placeholder="solar, storage" /></label>
              <label className={ui.sub}>Exclusions<input name="exclusions" /></label>
              <label className={ui.sub}>Desired outcome<textarea name="desiredOutcome" rows={2} /></label>
              <button className="btn btn--primary" type="submit">Save objective</button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}

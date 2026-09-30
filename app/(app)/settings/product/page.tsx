import Link from "next/link";
import { and, desc, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { productItems } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { BUILD_CATEGORIES, PRODUCT_CLASSES, PRODUCT_ITEM_KINDS, PRODUCT_STATUSES } from "@/lib/commercial/vocab";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { addProductItemAction, reviewProductItemAction } from "../../product-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product governance" };

const VIEWS = [["request", "Backlog", ["request", "idea"]], ["tech_debt", "Technical debt", ["tech_debt"]], ["product_debt", "Product debt", ["product_debt"]], ["bug", "Bugs", ["bug"]]] as const;

// Regenera-internal: the feature freeze made operational. Ideas (including the founder's) enter the backlog with the
// problem, user, evidence, frequency, revenue relevance, urgency and workaround; only bugs, depth and validated client
// requirements are accepted; client requests are classified core / vertical / configuration / custom / advisory.
export default async function ProductPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/product");
  const sp = await searchParams;
  const view = VIEWS.find(v => v[0] === sp.kind) ?? VIEWS[0];
  const rows = await appDb().select().from(productItems).where(and(mandateCondition(user.scope, productItems.mandateId), inArray(productItems.kind, [...view[2]]))).orderBy(desc(productItems.createdAt));
  const all = await appDb().select({ kind: productItems.kind, cls: productItems.classification, status: productItems.status }).from(productItems).where(mandateCondition(user.scope, productItems.mandateId));
  const classified = all.filter(x => x.cls && x.status !== "declined");
  const share = (k: string) => (classified.length ? Math.round((classified.filter(x => x.cls === k).length / classified.length) * 100) : 0);
  return (
    <>
      <h2>Product governance</h2>
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ maxWidth: 820 }}>Architecture is frozen at the module level. Work is accepted only as a <b>bug</b>, <b>depth</b> on an existing workflow, or a <b>validated client requirement</b>; &ldquo;interesting idea&rdquo; is not enough, including for founder ideas. Guidance, not a quota: about 80% core, 15% configuration, 5% custom.</p>
      {classified.length > 0 && <p className={ui.sub}>Classified items: {Object.entries(PRODUCT_CLASSES).map(([k, v]) => `${v.split(" (")[0]} ${share(k)}%`).join(" · ")}{share("custom") > 10 ? " — custom work is above guidance: review before merging into core." : ""}</p>}
      <nav className={ui.tabs} aria-label="Registers">{VIEWS.map(([k, label]) => <Link key={k} className={`${ui.tab} ${view[0] === k ? ui.tabActive : ""}`} href={`/settings/product?kind=${k}`}>{label}<span className={ui.tabCount}>{all.filter(x => (VIEWS.find(v => v[0] === k)![2] as readonly string[]).includes(x.kind)).length}</span></Link>)}</nav>
      <div className={r.grid}>
        <section className={r.panel}>
          {rows.length === 0 ? <p className={r.empty}>Nothing recorded.</p> : <table className={ui.table}><thead><tr><th>Item</th><th>Evidence</th><th>Review</th></tr></thead><tbody>
            {rows.map(x => <tr key={x.id}>
              <td className={ui.primary}>{x.title}<span className={ui.sub}>{PRODUCT_ITEM_KINDS[x.kind]} · {x.priority} · from {x.source}{x.owner ? ` · ${x.owner}` : ""}</span>{x.problem && <span className={ui.sub}>{x.problem}</span>}</td>
              <td className={ui.sub}>{[x.user && `User: ${x.user}`, x.evidence && `Evidence: ${x.evidence}`, x.frequency && `Frequency: ${x.frequency}`, x.revenueRelevance && `Revenue: ${x.revenueRelevance}`, x.urgency && `Urgency: ${x.urgency}`, x.workaround && `Workaround: ${x.workaround}`, x.component && `Component: ${x.component}`, x.impact && `Impact: ${x.impact}`, x.effort && `Effort: ${x.effort}`].filter(Boolean).map(t => <span key={t} style={{ display: "block" }}>{t}</span>)}</td>
              <td><form action={reviewProductItemAction} className={r.form}><input type="hidden" name="itemId" value={x.id} />
                <select name="classification" defaultValue={x.classification ?? ""} aria-label="Classification"><option value="">Unclassified</option>{Object.entries(PRODUCT_CLASSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="buildCategory" defaultValue={x.buildCategory} aria-label="Build category">{Object.entries(BUILD_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select name="status" defaultValue={x.status} aria-label="Status">{Object.entries(PRODUCT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="decisionNote" defaultValue={x.decisionNote} placeholder="Decision note" aria-label="Decision note" />
                <button className={ui.miniBtn} type="submit">Save</button>
                {x.reviewedBy && <span className={ui.sub}>Reviewed {x.reviewedAt?.slice(0, 10)} by {x.reviewedBy}</span>}</form></td>
            </tr>)}
          </tbody></table>}
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>Record</p>
          <form action={addProductItemAction} className={r.form}>
            <label>Kind<select name="kind" defaultValue={view[2][0]}>{Object.entries(PRODUCT_ITEM_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Title<input name="title" required /></label>
            <label>Problem<textarea name="problem" rows={2} /></label>
            <label>User<input name="user" placeholder="Capital analyst at a family office" /></label>
            <label>Evidence<textarea name="evidence" rows={2} placeholder="Which client, meeting or data shows this?" /></label>
            <div className={r.formRow}><label>Frequency<input name="frequency" /></label><label>Urgency<input name="urgency" /></label></div>
            <label>Revenue relevance<input name="revenueRelevance" /></label>
            <label>Existing workaround<input name="workaround" /></label>
            <div className={r.formRow}><label>Component<input name="component" /></label><label>Effort<input name="effort" placeholder="S / M / L" /></label></div>
            <label>Impact<input name="impact" /></label>
            <div className={r.formRow}><label>Priority<select name="priority" defaultValue="medium"><option>critical</option><option>high</option><option>medium</option><option>low</option></select></label>
              <label>Source<select name="source" defaultValue="internal"><option>internal</option><option>founder</option><option>client</option><option>support</option></select></label></div>
            <label>Owner<input name="owner" type="email" /></label>
            <button className="btn btn--primary" type="submit">Record</button>
          </form></section></aside>
      </div>
    </>
  );
}

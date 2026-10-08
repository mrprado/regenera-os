import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { documents, mandates, organizations, protectedParties, regulatedProducts } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { addProtectedPartyAction, addRegulatedProductAction, removeGuardrailAction } from "../../casework-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guardrails" };

export default async function GuardrailsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/network/guardrails");
  const sp = await searchParams;
  const db = appDb();
  const ids = user.scope.mandateIds;
  const [products, parties, ws, orgs, docs] = await Promise.all([
    db.select().from(regulatedProducts).where(mandateCondition(user.scope, regulatedProducts.mandateId)).orderBy(desc(regulatedProducts.createdAt)),
    db.select().from(protectedParties).where(mandateCondition(user.scope, protectedParties.mandateId)).orderBy(desc(protectedParties.createdAt)),
    ids.length ? db.select({ id: mandates.id, name: mandates.name }).from(mandates).where(inArray(mandates.id, ids)) : Promise.resolve([]),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(mandateCondition(user.scope, organizations.mandateId)).orderBy(organizations.name).limit(800),
    db.select({ id: documents.id, title: documents.title }).from(documents).where(mandateCondition(user.scope, documents.mandateId)).limit(400),
  ]);
  const owner = isOwner(user.scope);
  const today = new Date().toISOString().slice(0, 10);
  const orgName = (id: string | null) => orgs.find(o => o.id === id)?.name;
  const wsField = <label>Workspace<select name="mandateId">{ws.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>;
  return <>
    <PageHeader title="Guardrails" />
    <Notice text={sp.notice} />
    <p className={ui.notice}>Regulatory limits recorded as data. A regulated product is a sponsor&apos;s security or fund (bonds, preference shares, fund units): any outbound draft that names one is held at send for counsel. A protected party is covered by a non-circumvention clause: introductions to it are blocked until the protection ends.</p>
    <div className={r.grid}>
      <section className={r.panel}>
        <p className={r.panelTitle}>Regulated products ({products.length})</p>
        {products.length === 0 ? <p className={r.empty}>None recorded.</p> : <table className={ui.table}><tbody>{products.map(p => <tr key={p.id}><td><b>{p.name}</b> <span className={ui.chip}>{p.kind}</span><div className={ui.sub}>{orgName(p.orgId) ?? ""}{p.aliases.length ? ` · also: ${p.aliases.join(", ")}` : ""}{p.note ? ` · ${p.note}` : ""}</div></td>
          <td>{owner && <form action={removeGuardrailAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="table" value="product" /><button className={ui.miniBtn} type="submit">Remove</button></form>}</td></tr>)}</tbody></table>}
        <p className={r.panelTitle} style={{ marginTop: 24 }}>Protected parties ({parties.length})</p>
        {parties.length === 0 ? <p className={r.empty}>None recorded.</p> : <table className={ui.table}><tbody>{parties.map(p => { const active = !p.until || p.until >= today; return <tr key={p.id}><td><b>{p.orgId ? <Link href={`/companies/${p.orgId}`}>{p.partyName}</Link> : p.partyName}</b> <span className={`${ui.chip} ${active ? ui.chipEmber : ui.chipMuted}`}>{active ? `protected${p.until ? ` until ${p.until}` : ""}` : `ended ${p.until}`}</span>
          <div className={ui.sub}>For {p.protectedFor}{p.agreementDocumentId ? " · agreement on file" : ""}{p.note ? ` · ${p.note}` : ""}</div></td>
          <td>{owner && <form action={removeGuardrailAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="table" value="party" /><button className={ui.miniBtn} type="submit">Remove</button></form>}</td></tr>; })}</tbody></table>}
      </section>
      <aside>
        {owner ? <>
          <section className={r.panel}><p className={r.panelTitle}>Add a regulated product</p>
            <form action={addRegulatedProductAction} className={r.form}>{wsField}
              <label>Issuer / sponsor<select name="orgId"><option value="">—</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label>Product name<input name="name" required placeholder="e.g. RA-ESG Income Bond" /></label>
              <label>Kind<select name="kind"><option value="bond">Bond / loan note</option><option value="shares">Shares</option><option value="fund">Fund units</option><option value="scheme">Scheme</option><option value="other">Other</option></select></label>
              <label>Other names (comma-separated)<input name="aliases" placeholder="Growth Bond, preference shares" /></label>
              <label>Note<input name="note" /></label><button className="btn" type="submit">Add</button></form></section>
          <section className={r.panel}><p className={r.panelTitle}>Add a protected party</p>
            <form action={addProtectedPartyAction} className={r.form}>{wsField}
              <label>Party<input name="partyName" required /></label>
              <label>Organization (if recorded)<select name="orgId"><option value="">—</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label>Protected for<input name="protectedFor" required placeholder="e.g. RA-ESG under its introducer agreement" /></label>
              <label>Until<input type="date" name="until" /></label>
              <label>Agreement<select name="agreementDocumentId"><option value="">—</option>{docs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
              <label>Note<input name="note" /></label><button className="btn" type="submit">Add</button></form></section>
        </> : <section className={r.panel}><p className={r.empty}>Owners record guardrails.</p></section>}
      </aside>
    </div>
  </>;
}

import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { epds, networkProfiles, organizations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { LCA_STAGES, MATERIAL_CATEGORIES, NETWORK_ROLES } from "@/lib/procurement/vocab";
import { ASSET_CLASSES } from "@/lib/projects/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { addEpdAction, saveNetworkProfileAction } from "../procurement-actions";
import styles from "../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Builders and suppliers" };

export default async function NetworkPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/network");
  const sp = await searchParams;
  const tab = sp.tab === "epds" ? "epds" : "profiles";
  const today = new Date().toISOString().slice(0, 10);
  const [profiles, orgs, library] = await Promise.all([
    appDb().select({ p: networkProfiles, name: organizations.name, country: organizations.country }).from(networkProfiles).innerJoin(organizations, eq(organizations.id, networkProfiles.orgId))
      .where(mandateCondition(user.scope, networkProfiles.mandateId)).orderBy(asc(organizations.name)),
    appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(mandateCondition(user.scope, organizations.mandateId)).orderBy(asc(organizations.name)).limit(1000),
    appDb().select().from(epds).where(mandateCondition(user.scope, epds.mandateId)).orderBy(asc(epds.category), asc(epds.product)),
  ]);
  const role = sp.role && sp.role in NETWORK_ROLES ? sp.role : null;
  const shown = profiles.filter(x => !role || x.p.roles.includes(role));

  return (
    <>
      <PageHeader title="Builders and suppliers" count={tab === "epds" ? library.length : shown.length} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Network sections">
        <Link className={`${ui.tab} ${tab === "profiles" ? ui.tabActive : ""}`} href="/network">EPC, OEM and supplier network</Link>
        <Link className={`${ui.tab} ${tab === "epds" ? ui.tabActive : ""}`} href="/network?tab=epds">EPD library</Link>
      </nav>

      {tab === "profiles" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>What they can build or supply</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Profiles feed the &quot;Who could bid&quot; list on each procurement package: asset class, countries, project size, bankability and track record. <Link href="/network">All</Link>{Object.entries(NETWORK_ROLES).map(([k, v]) => <span key={k}> · <Link href={`/network?role=${k}`}>{v}</Link></span>)}</p>
            {shown.length === 0 ? <p className={r.empty}>No profiles yet. Add one for each EPC, OEM, supplier or engineering firm you would put in front of a project.</p> : (
              <table className={ui.table}><tbody>{shown.map(({ p, name }) => (
                <tr key={p.id}>
                  <td><Link href={`/companies/${p.orgId}`}><b>{name}</b></Link>{p.bankable ? <span className={ui.chip} style={{ marginLeft: 6 }}>Bankable</span> : null}
                    <span className={ui.sub} style={{ display: "block" }}>{[p.roles.map(x => NETWORK_ROLES[x as keyof typeof NETWORK_ROLES] ?? x).join(", "), p.assetClasses.map(a => ASSET_CLASSES[a as keyof typeof ASSET_CLASSES] ?? a).join(", "), p.technologies,
                      p.jurisdictions.length && `in ${p.jurisdictions.join(", ")}`, (p.minProjectSize !== null || p.maxProjectSize !== null) && `${compactMoney(p.minProjectSize, p.currency)}–${compactMoney(p.maxProjectSize, p.currency)}`,
                      p.completedAssets !== null && `${p.completedAssets} completed assets`].filter(Boolean).join(" · ")}</span>
                    <span className={ui.sub} style={{ display: "block" }}>{[p.trackRecord, p.bonding && `bonding: ${p.bonding}`, p.insurance && `insurance: ${p.insurance}`, p.balanceSheet && `balance sheet: ${p.balanceSheet}`, p.warranty && `warranty: ${p.warranty}`, p.references && `references: ${p.references}`, p.performance && `our experience: ${p.performance}`].filter(Boolean).join(" · ")}</span></td>
                </tr>
              ))}</tbody></table>
            )}
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Add or update a profile</p>
              <form action={saveNetworkProfileAction} className={styles.stack}>
                <label>Organization<select name="orgId" required defaultValue=""><option value="" disabled>Choose</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className={ui.sub}>Roles</legend><div className={styles.checks}>{Object.entries(NETWORK_ROLES).map(([k, v]) => <label key={k}><input type="checkbox" name="roles" value={k} />{v}</label>)}</div></fieldset>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className={ui.sub}>Asset classes</legend><div className={styles.checks}>{Object.entries(ASSET_CLASSES).map(([k, v]) => <label key={k}><input type="checkbox" name="assetClasses" value={k} />{v}</label>)}</div></fieldset>
                <label>Technologies<input name="technologies" placeholder="e.g. single-axis trackers, LFP BESS" /></label>
                <label>Countries (present or licensed)<input name="jurisdictions" placeholder="MEX, USA, COL" /></label>
                <label>Min project size<input name="minProjectSize" inputMode="decimal" /></label>
                <label>Max project size<input name="maxProjectSize" inputMode="decimal" /></label>
                <label>Currency<input name="currency" defaultValue="USD" /></label>
                <label>Completed assets<input name="completedAssets" inputMode="numeric" /></label>
                <label>Track record<textarea name="trackRecord" rows={2} /></label>
                <label>Bonding capacity<input name="bonding" /></label>
                <label>Insurance<input name="insurance" /></label>
                <label>Balance sheet<input name="balanceSheet" /></label>
                <label>Warranty<input name="warranty" /></label>
                <label>References<input name="references" /></label>
                <label>Our experience with them<input name="performance" /></label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="bankable" /> Accepted by lenders (bankable)</label>
                <button className="btn btn--primary" type="submit">Save profile</button>
              </form>
              <p className={ui.sub}>Saving again for the same organization replaces its profile.</p>
            </section>
          </aside>
        </div>
      )}

      {tab === "epds" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Environmental Product Declarations</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Enter values exactly as published (kg CO₂e per declared unit, EN 15804 stages). Embodied carbon on a project is computed only from these; nothing is estimated.</p>
            {library.length === 0 ? <p className={r.empty}>No EPDs yet.</p> : (
              <table className={ui.table}><tbody>{library.map(e => (
                <tr key={e.id}>
                  <td><b>{e.manufacturer} · {e.product}</b> · {MATERIAL_CATEGORIES[e.category]}{e.verified ? <span className={ui.chip} style={{ marginLeft: 6 }}>Verified</span> : null}
                    <span className={ui.sub} style={{ display: "block" }}>{[`per ${e.declaredUnit}`, ...Object.entries(e.gwp).map(([s, v]) => `${LCA_STAGES[s as keyof typeof LCA_STAGES]}: ${v}`), e.programOperator, e.registrationNumber, e.pcr && `PCR ${e.pcr}`, e.geography,
                      e.validUntil && `valid to ${e.validUntil}${e.validUntil < today ? " (expired)" : ""}`, e.verifier && `verified by ${e.verifier}`].filter(Boolean).join(" · ")}</span>
                    {e.url && <a className={ui.sub} href={e.url} target="_blank" rel="noreferrer">Source</a>}</td>
                </tr>
              ))}</tbody></table>
            )}
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Add an EPD</p>
              <form action={addEpdAction} className={styles.stack}>
                <label>Manufacturer<input name="manufacturer" required minLength={2} /></label>
                <label>Product<input name="product" required minLength={2} /></label>
                <label>Category<select name="category" defaultValue="other">{Object.entries(MATERIAL_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Declared unit<input name="declaredUnit" required placeholder="t, m³, unit, kWp" /></label>
                {Object.entries(LCA_STAGES).map(([k, v]) => <label key={k}>GWP {v} (kg CO₂e){k === "a1a3" ? " *" : ""}<input name={`gwp_${k}`} inputMode="decimal" required={k === "a1a3"} /></label>)}
                <label>Program operator<input name="programOperator" placeholder="EPD International, IBU, UL …" /></label>
                <label>Registration number<input name="registrationNumber" /></label>
                <label>PCR<input name="pcr" /></label>
                <label>Geography<input name="geography" /></label>
                <label>Valid from<input name="validFrom" type="date" /></label>
                <label>Valid until<input name="validUntil" type="date" /></label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="verified" /> Third-party verified</label>
                <label>Verifier<input name="verifier" /></label>
                <label>Link to the EPD<input name="url" type="url" /></label>
                <button className="btn btn--primary" type="submit">Add</button>
              </form>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

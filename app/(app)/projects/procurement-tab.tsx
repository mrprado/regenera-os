import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { bids, contracts, networkProfiles, organizations, procurementPackages } from "@/db/schema";
import type { OsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { effectiveWeights, evaluateBids, matchNetwork } from "@/lib/procurement/logic";
import { BID_STATUSES, CRITERIA, INCOTERMS, NETWORK_ROLES, PACKAGE_CATEGORIES, PACKAGE_STAGES, type Criterion, type PackageCategory } from "@/lib/procurement/vocab";
import { compactMoney } from "@/lib/projects/labels";
import { lifecycleLabel } from "@/lib/contracts/labels";
import { addBidAction, addPackageAction, awardBidAction, inviteFromNetworkAction, scoreBidAction, updatePackageAction } from "../procurement-actions";
import styles from "./projects.module.css";

// Which network role fits a package.
const ROLE_FOR: Record<PackageCategory, string | undefined> = {
  epc: "epc", equipment: "oem", bop: "contractor", civil: "contractor", electrical: "contractor", supply: "supplier", services: undefined,
  consultancy: "engineer", logistics: "logistics", om: "om", other: undefined,
};
const CRIT = Object.keys(CRITERIA) as Criterion[];

/** Procurement pipeline per package: bids with supply-chain terms, weighted technical + commercial evaluation, award
 * (which registers the agreement), and who in the network could bid. */
export default async function ProcurementTab({ project, scope, pkgId }: { project: { id: string; assetClass: string | null; country: string | null; capex: number | null; currency: string | null }; scope: OsUser["scope"]; pkgId?: string }) {
  const packages = await appDb().select().from(procurementPackages).where(eq(procurementPackages.projectId, project.id)).orderBy(asc(procurementPackages.createdAt));
  const pkg = packages.find(p => p.id === pkgId) ?? packages.find(p => p.stage !== "closed" && p.stage !== "cancelled") ?? packages[0];
  const [bidRows, orgs, profiles, contract] = await Promise.all([
    pkg ? appDb().select().from(bids).where(eq(bids.packageId, pkg.id)).orderBy(asc(bids.createdAt)) : [],
    appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(mandateCondition(scope, organizations.mandateId)).orderBy(asc(organizations.name)).limit(1000),
    appDb().select().from(networkProfiles).where(mandateCondition(scope, networkProfiles.mandateId)),
    pkg?.contractId ? appDb().select({ id: contracts.id, title: contracts.title, lifecycle: contracts.lifecycle }).from(contracts).where(and(eq(contracts.id, pkg.contractId), mandateCondition(scope, contracts.mandateId))).then(x => x[0]) : undefined,
  ]);
  const evaluation = pkg ? evaluateBids(bidRows, pkg.weights) : { ranked: [], notes: [] };
  const w = pkg ? effectiveWeights(pkg.weights) : effectiveWeights({});
  const matches = pkg ? matchNetwork(project, profiles, ROLE_FOR[pkg.category]).filter(m => !bidRows.some(b => b.orgId === m.orgId)).slice(0, 8) : [];
  const orgName = new Map(orgs.map(o => [o.id, o.name]));
  const matchNames = matches.length ? await appDb().select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, matches.map(m => m.orgId))) : [];
  for (const m of matchNames) orgName.set(m.id, m.name);

  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>Packages</p>
          {packages.length === 0 ? <p className={r.empty}>No procurement packages. Split the project into what will be tendered (EPC or multi-contract: modules, inverters, BoP, civil …).</p> : (
            <nav className={ui.tabs} aria-label="Packages">
              {packages.map(p => <Link key={p.id} className={`${ui.tab} ${p.id === pkg?.id ? ui.tabActive : ""}`} href={`/projects/${project.id}?tab=procurement&pkg=${p.id}`}>{p.name} · {PACKAGE_STAGES[p.stage]}</Link>)}
            </nav>
          )}
          {pkg && (
            <>
              <dl className={r.kv}>
                <dt>Category</dt><dd>{PACKAGE_CATEGORIES[pkg.category]}{pkg.owner ? ` · owner ${pkg.owner}` : ""}</dd>
                {pkg.scope && <><dt>Scope</dt><dd>{pkg.scope}</dd></>}
                <dt>Budget</dt><dd>{compactMoney(pkg.budget, pkg.currency)}</dd>
                <dt>Dates</dt><dd>{[pkg.bidsDueAt && `bids due ${pkg.bidsDueAt}`, pkg.awardTargetAt && `award by ${pkg.awardTargetAt}`, pkg.requiredOnSiteAt && `needed on site ${pkg.requiredOnSiteAt}`].filter(Boolean).join(" · ") || "Not set"}</dd>
                <dt>E&amp;S flow-down</dt><dd>{pkg.esRequirements || "None recorded. Lender E&S standards (labour, OHS, community) usually have to reach contractors and suppliers."}</dd>
                {pkg.localContentTargetPct !== null && <><dt>Local content</dt><dd>target {pkg.localContentTargetPct}%</dd></>}
                {contract && <><dt>Agreement</dt><dd><Link href={`/contracts/${contract.id}`}>{contract.title}</Link> · {lifecycleLabel(contract.lifecycle)}</dd></>}
              </dl>
              <form action={updatePackageAction} className={styles.inline} style={{ marginTop: 8 }}>
                <input type="hidden" name="packageId" value={pkg.id} />
                <select name="stage" defaultValue={pkg.stage} aria-label="Stage">{Object.entries(PACKAGE_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="bidsDueAt" type="date" defaultValue={pkg.bidsDueAt ?? ""} aria-label="Bids due" title="Bids due" />
                <input name="awardTargetAt" type="date" defaultValue={pkg.awardTargetAt ?? ""} aria-label="Award target" title="Award target" />
                <input name="requiredOnSiteAt" type="date" defaultValue={pkg.requiredOnSiteAt ?? ""} aria-label="Needed on site" title="Needed on site" />
                <button className={ui.miniBtn} type="submit">Update</button>
              </form>
            </>
          )}
        </section>

        {pkg && (
          <section className={r.panel}>
            <p className={r.panelTitle}>Bids and evaluation</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>Weighted score out of 10. Cost is scored from the lowest price when all bids share a currency; other criteria are the evaluators&apos; scores (0–10). Unscored criteria count as zero.</p>
            {evaluation.notes.map(n => <p key={n} className={styles.flag}>{n}</p>)}
            {bidRows.length === 0 ? <p className={r.empty}>No bids yet. Add bidders below or invite from the network.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table className={ui.table}>
                  <thead><tr><th>Bidder</th><th className={ui.num}>Price</th>{CRIT.filter(c => w[c] > 0).map(c => <th key={c} className={ui.num} title={`Weight ${w[c]}`}>{CRITERIA[c]} ({w[c]})</th>)}<th className={ui.num}>Score</th><th /></tr></thead>
                  <tbody>{bidRows.map(b => {
                    const ev = evaluation.ranked.find(x => x.id === b.id);
                    const formId = `score-${b.id}`;
                    return (
                      <tr key={b.id}>
                        <td><b>{ev ? `#${ev.rank} ` : ""}{b.orgId ? <Link href={`/companies/${b.orgId}`}>{b.bidder}</Link> : b.bidder}</b>
                          <span className={ui.sub} style={{ display: "block" }}>{[BID_STATUSES[b.status], b.scheduleWeeks !== null && `${b.scheduleWeeks} wk schedule`, b.leadTimeWeeks !== null && `${b.leadTimeWeeks} wk lead`, b.warrantyYears !== null && `${b.warrantyYears} yr warranty`,
                            b.liquidatedDamages && `LDs: ${b.liquidatedDamages}`, b.originCountry && `made in ${b.originCountry}${b.factory ? ` (${b.factory})` : ""}`, b.incoterms && `${b.incoterms}${b.port ? ` ${b.port}` : ""}`,
                            b.localContentPct !== null && `${b.localContentPct}% local`, b.financingSupport && `financing: ${b.financingSupport}`, b.exceptions && `exceptions: ${b.exceptions}`].filter(Boolean).join(" · ")}</span>
                          <form id={formId} action={scoreBidAction}><input type="hidden" name="bidId" value={b.id} /></form></td>
                        <td className={ui.num}><input form={formId} name="price" defaultValue={b.price ?? ""} inputMode="decimal" aria-label="Price" style={{ width: 100 }} /><span className={ui.sub}>{b.currency}</span></td>
                        {CRIT.filter(c => w[c] > 0).map(c => (
                          <td key={c} className={ui.num}>
                            {c === "cost" && b.scores.cost === undefined ? <span title="Scored from price">{ev?.byCriterion.cost?.toFixed(1) ?? "—"}</span>
                              : <input form={formId} name={`s_${c}`} defaultValue={b.scores[c] ?? ""} inputMode="decimal" aria-label={`${CRITERIA[c]} score`} style={{ width: 44 }} />}
                          </td>
                        ))}
                        <td className={ui.num}><b>{ev ? ev.total.toFixed(2) : "—"}</b>{ev?.missing.length ? <span className={ui.sub} title={ev.missing.map(c => CRITERIA[c]).join(", ")}>{ev.missing.length} unscored</span> : null}</td>
                        <td>
                          <select form={formId} name="status" defaultValue={b.status} aria-label="Status">{Object.entries(BID_STATUSES).filter(([k]) => k !== "selected" || b.status === "selected").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                          <button form={formId} className={ui.miniBtn} type="submit">Save</button>
                          {!pkg.awardedBidId && ev && <form action={awardBidAction} style={{ marginTop: 4 }}><input type="hidden" name="bidId" value={b.id} /><button className={ui.miniBtn} type="submit">Award</button></form>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
            <details style={{ marginTop: 8 }}><summary className={ui.sub}>Evaluation weights</summary>
              <form action={updatePackageAction} className={styles.grid2} style={{ marginTop: 6 }}>
                <input type="hidden" name="packageId" value={pkg.id} />
                {CRIT.map(c => <label key={c}>{CRITERIA[c]}<input name={`w_${c}`} defaultValue={w[c]} inputMode="numeric" /></label>)}
                <button className={ui.miniBtn} type="submit">Save weights</button>
              </form>
            </details>
            <details style={{ marginTop: 8 }}><summary className={ui.sub}>Add a bid</summary>
              <form action={addBidAction} className={styles.grid2} style={{ marginTop: 6 }}>
                <input type="hidden" name="packageId" value={pkg.id} />
                <label>Organization<select name="orgId" defaultValue=""><option value="">Not in Companies</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <label>Or bidder name<input name="bidder" /></label>
                <label>Price<input name="price" inputMode="decimal" /></label>
                <label>Currency<input name="currency" defaultValue={pkg.currency} /></label>
                <label>Schedule (weeks)<input name="scheduleWeeks" inputMode="decimal" /></label>
                <label>Lead time (weeks)<input name="leadTimeWeeks" inputMode="decimal" /></label>
                <label>Warranty (years)<input name="warrantyYears" inputMode="decimal" /></label>
                <label>Liquidated damages<input name="liquidatedDamages" /></label>
                <label>Origin country<input name="originCountry" /></label>
                <label>Factory<input name="factory" /></label>
                <label>Incoterms<select name="incoterms" defaultValue=""><option value="">Not set</option>{INCOTERMS.map(i => <option key={i} value={i}>{i}</option>)}</select></label>
                <label>Port<input name="port" /></label>
                <label>Local content (%)<input name="localContentPct" inputMode="decimal" /></label>
                <label>Financing support<input name="financingSupport" placeholder="ECA cover, vendor finance" /></label>
                <label className={styles.wide}>Exceptions / deviations<input name="exceptions" /></label>
                <button className="btn" type="submit">Add bid</button>
              </form>
            </details>
          </section>
        )}

        {pkg && (
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Who could bid{ROLE_FOR[pkg.category] ? ` (${NETWORK_ROLES[ROLE_FOR[pkg.category] as keyof typeof NETWORK_ROLES]})` : ""}</span><Link href="/network">Network</Link></p>
            {matches.length === 0 ? <p className={r.empty}>No matching profiles. Record what builders and suppliers can do in the <Link href="/network">network</Link>.</p> : (
              <table className={ui.table}><tbody>{matches.map(m => (
                <tr key={m.profileId}>
                  <td><Link href={`/companies/${m.orgId}`}>{orgName.get(m.orgId) ?? "Organization"}</Link><span className={ui.sub} style={{ display: "block" }}>{m.reasons.join(" · ")}{m.gaps.length ? ` · gaps: ${m.gaps.join(", ").toLowerCase()}` : ""}</span></td>
                  <td><form action={inviteFromNetworkAction}><input type="hidden" name="packageId" value={pkg.id} /><input type="hidden" name="orgId" value={m.orgId} /><button className={ui.miniBtn} type="submit">Add as invited</button></form></td>
                </tr>
              ))}</tbody></table>
            )}
          </section>
        )}
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Add a package</p>
          <form action={addPackageAction} className={styles.stack}>
            <input type="hidden" name="id" value={project.id} />
            <label>Name<input name="name" required minLength={2} placeholder="e.g. PV modules supply" /></label>
            <label>Category<select name="category" required>{Object.entries(PACKAGE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Scope<textarea name="scope" rows={2} /></label>
            <label>Stage<select name="stage" defaultValue="need">{Object.entries(PACKAGE_STAGES).filter(([k]) => !["award", "manufacturing", "logistics", "delivery", "closed"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Budget<input name="budget" inputMode="decimal" /></label>
            <label>Currency<input name="currency" defaultValue={project.currency ?? "USD"} /></label>
            <label>Bids due<input name="bidsDueAt" type="date" /></label>
            <label>Award target<input name="awardTargetAt" type="date" /></label>
            <label>Needed on site<input name="requiredOnSiteAt" type="date" /></label>
            <label>E&amp;S requirements to flow down<textarea name="esRequirements" rows={2} placeholder="e.g. IFC PS2 labour standards, worker grievance mechanism, OHS plan" /></label>
            <label>Local content target (%)<input name="localContentTargetPct" inputMode="decimal" /></label>
            <label>Owner<input name="owner" /></label>
            <button className="btn btn--primary" type="submit">Add</button>
          </form>
        </section>
      </aside>
    </div>
  );
}

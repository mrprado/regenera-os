import Link from "next/link";
import { and, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { organizations, projectParties } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { LANES } from "@/lib/capital/programmes";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { countryRisk, fmtReading } from "@/lib/fabric/country";
import { portfolioCsv, PRECISION, screenPortfolio } from "@/lib/portfolio/screen";
import { SANCTIONS_REVIEW } from "@/lib/ontology/taxonomies";
import { checkRegistryAction, portfolioSiteChecksAction } from "../../casework-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio screening" };

const READING: Record<string, string> = { above_tracking: "Above tracking potential", needs_tracking: "Needs tracking / DC oversizing", below_fixed: "Below fixed potential", consistent_fixed: "Consistent", no_reference: "No site reference yet" };

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/projects");
  const sp = await searchParams;
  const db = appDb();
  const sponsorIds = [...new Set((await db.select({ orgId: projectParties.orgId }).from(projectParties).where(and(mandateCondition(user.scope, projectParties.mandateId), inArray(projectParties.role, ["sponsor", "developer"])))).map(x => x.orgId).filter(Boolean) as string[])];
  const sponsors = sponsorIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, sponsorIds.slice(0, 90))) : [];
  const named = sp.q ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(mandateCondition(user.scope, organizations.mandateId)).then(rows => rows.filter(o => o.name.toLowerCase().includes(sp.q!.toLowerCase())).slice(0, 10)) : [];
  const s = sp.org ? await screenPortfolio(db, user.scope.mandateIds, sp.org) : null;
  const risks = s ? await Promise.all(s.countries.map(c => countryRisk(db, c).catch(() => null))) : [];
  const sanctionLabel = (st: string) => st === "not_screened" ? "Not screened" : st === "clear" ? "No match" : st === "pending" ? "Possible match: review" : SANCTIONS_REVIEW[st as "cleared" | "confirmed"];
  return <>
    <PageHeader title="Portfolio screening" />
    <Notice text={sp.notice} />
    <p className={ui.notice}>Every project of one sponsor in one table: where each sits and how exactly, whether stated energy fits the public solar resource, which capital programmes fit, how full the data room is and what is still outstanding. Readings and questions for the sponsor, not a score.</p>
    <section className={r.panel}>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label>Sponsor<select name="org" defaultValue={sp.org ?? ""}><option value="">Choose…</option>{[...sponsors, ...named].map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>or find by name<input name="q" defaultValue={sp.q ?? ""} placeholder="e.g. RA-ESG" /></label>
        <button className={ui.miniBtn} type="submit">Open</button>
      </form>
    </section>
    {sp.org && !s && <p className={r.empty}>Sponsor not found in your workspaces.</p>}
    {s && <>
      <section className={r.panel}>
        <p className={r.panelTitle}>{s.org.name}: {s.rows.length} project(s)</p>
        <p className={ui.sub}>Sanctions: {sanctionLabel(s.sanctions)} · Registry: {s.registry ? `${s.registry.data.status ?? "?"} at Companies House, checked ${s.registry.fetchedAt.slice(0, 10)}${s.registry.changes.length ? `, ${s.registry.changes.length} change(s) last time` : ""}` : "not checked"} · Open sponsor requests: {s.sponsorOpenItems}</p>
        {s.rows.length === 0 ? <p className={r.empty}>No projects linked to this sponsor yet (as a party, or mentioning its name).</p> :
          <table className={ui.table}><thead><tr><th>Project</th><th>Country · MW</th><th>Location</th><th>Stated vs resource (kWh/kW)</th><th>Capital programmes</th><th>Data room</th><th>Open requests</th></tr></thead><tbody>
            {s.rows.map(x => <tr key={x.id}><td><Link href={`/projects/${x.id}?tab=diligence`}><b>{x.name}</b></Link><div className={ui.sub}>{x.stage.replace(/_/g, " ")}</div></td>
              <td>{x.country ?? "—"} · {x.capacityMw ?? "—"}</td>
              <td className={ui.sub}>{x.located ? (x.precision ? PRECISION[x.precision as keyof typeof PRECISION] ?? x.precision : "Located (precision not recorded)") : <Link href={`/projects/${x.id}?tab=questions#place`}>Not located: place it</Link>}</td>
              <td className={ui.sub}>{x.yield ? <>{x.yield.statedKwhPerKw.toLocaleString("en-US")} vs fixed {x.yield.fixed ? Math.round(x.yield.fixed).toLocaleString("en-US") : "—"} / tracking {x.yield.tracking ? Math.round(x.yield.tracking).toLocaleString("en-US") : "—"}<br /><b>{READING[x.yield.reading]}</b></> : x.energyGwh ? "Needs site reference" : "No stated energy claim"}</td>
              <td className={ui.sub}>{x.programmes} · {Object.entries(x.lanes).map(([l, n]) => `${LANES[l as keyof typeof LANES].split(" (")[0]} ${n}`).join(", ")}</td>
              <td className={ui.num}>{x.roomFilled}/{x.roomTotal}</td><td className={ui.num}>{x.openItems}</td></tr>)}
          </tbody></table>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <form action={portfolioSiteChecksAction}><input type="hidden" name="orgId" value={s.org.id} /><button className={ui.miniBtn} type="submit">Run site checks (3 per run)</button></form>
          <a className={ui.miniBtn} download={`portfolio-${s.org.name.replace(/\W+/g, "-")}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(portfolioCsv(s.rows))}`}>Download CSV</a>
          <Link className={ui.miniBtn} href={`/projects/portfolio/memo?org=${s.org.id}`}>Portfolio memo</Link>
          <Link className={ui.miniBtn} href={`/documents/requests?org=${s.org.id}`}>Request documents</Link>
        </div>
      </section>
      <div className={r.grid}>
        <section className={r.panel}><p className={r.panelTitle}>Country risk</p>
          {risks.filter(Boolean).length === 0 ? <p className={r.empty}>No country data yet.</p> : risks.filter(Boolean).map(c => <div key={c!.iso3} style={{ marginBottom: 14 }}>
            <b>{c!.iso3}</b>{c!.note && <p className={ui.sub}>{c!.note}</p>}
            <table className={ui.table}><tbody>{c!.readings.map(x => <tr key={x.code}><td>{x.label}</td><td className={ui.num}>{fmtReading(x)}</td></tr>)}</tbody></table></div>)}
          <p className={ui.sub}>World Bank WDI and Worldwide Governance Indicators. Readings, not a rating.</p>
        </section>
        <aside><section className={r.panel}><p className={r.panelTitle}>Sponsor registry check</p>
          {s.registry ? <>
            <p className={ui.sub}>{s.registry.companyNumber} · {s.registry.data.status} · incorporated {s.registry.data.incorporated ?? "?"} · last accounts to {s.registry.data.accountsLastMadeUpTo ?? "?"}{s.registry.data.accountsOverdue ? " · OVERDUE" : ""}</p>
            <ul className={ui.sub}>{s.registry.data.officers.filter(o => !o.resigned).map(o => <li key={o.name + o.role}>{o.name} ({o.role.replace(/-/g, " ")})</li>)}</ul>
            <p className={ui.sub}>Charges: {s.registry.data.charges.map(c => `${c.status} (${c.entitled.join(", ")})`).join("; ") || "none"}</p>
            {s.registry.changes.length > 0 && <><b>Changed since previous check</b><ul className={ui.sub}>{s.registry.changes.map((c, i) => <li key={i}>{c.detail}</li>)}</ul></>}
          </> : <p className={r.empty}>Not checked yet.</p>}
          <form action={checkRegistryAction} className={r.form}><input type="hidden" name="orgId" value={s.org.id} /><input type="hidden" name="back" value={`/projects/portfolio?org=${s.org.id}`} />
            <label>Companies House number<input name="companyNumber" defaultValue={s.registry?.companyNumber ?? ""} placeholder="e.g. 15115086" /></label>
            <button className="btn" type="submit">Check registry</button></form>
          <p className={ui.sub}>UK companies; needs the free COMPANIES_HOUSE_API_KEY. Re-checked weekly; changes raise a notification.</p>
        </section></aside>
      </div>
    </>}
  </>;
}

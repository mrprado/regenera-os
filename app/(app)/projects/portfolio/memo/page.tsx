import Link from "next/link";
import { notFound } from "next/navigation";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { COUNTRY_NOTES, LANES, matchProgrammes } from "@/lib/capital/programmes";
import { appDb } from "@/lib/db/scoped";
import { countryRisk, fmtReading } from "@/lib/fabric/country";
import { PRECISION, screenPortfolio, sponsorProjects } from "@/lib/portfolio/screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio memo" };

/** Printable multi-project case study generated from OS records (phase 20 §9). Print to PDF from the browser. */
export default async function MemoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/projects");
  const sp = await searchParams;
  if (!sp.org) notFound();
  const db = appDb();
  const s = await screenPortfolio(db, user.scope.mandateIds, sp.org);
  if (!s) notFound();
  const projs = await sponsorProjects(db, user.scope.mandateIds, s.org);
  const risks = (await Promise.all(s.countries.map(c => countryRisk(db, c).catch(() => null)))).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const above = s.rows.filter(x => x.yield?.reading === "above_tracking");
  const unlocated = s.rows.filter(x => !x.located);
  return <article style={{ maxWidth: 900, margin: "0 auto" }}>
    <p className={ui.sub}><Link href={`/projects/portfolio?org=${s.org.id}`}>Back to screening</Link> · Print this page to save it as a PDF.</p>
    <h1>{s.org.name}: portfolio case study</h1>
    <p className={ui.sub}>Regenera · generated {today} from Regenera OS records · confidential · not investment, legal or engineering advice. Sponsor figures are as stated (claims marked source-provided) unless marked verified.</p>

    <h2>Summary</h2>
    <ul>
      <li>{s.rows.length} project(s) across {s.countries.length} countr{s.countries.length === 1 ? "y" : "ies"} ({s.countries.join(", ") || "none recorded"}).</li>
      <li>{unlocated.length ? `${unlocated.length} project(s) have no location, so site checks cannot run for them.` : "Every project has a location."}</li>
      <li>{above.length ? `Stated energy exceeds single-axis tracking potential at ${above.length} project(s) (${above.map(x => x.name).join(", ")}): ask whether capacity is AC with DC oversizing, and for independent P50/P90 yield reports.` : "No stated energy above the tracking potential among projects with a site reference."}</li>
      <li>Sponsor sanctions screening: {s.sanctions.replace(/_/g, " ")}. Registry: {s.registry ? `${s.registry.data.status} (checked ${s.registry.fetchedAt.slice(0, 10)})` : "not checked"}.</li>
      <li>Open document request items: {s.sponsorOpenItems + s.rows.reduce((n, x) => n + x.openItems, 0)}.</li>
    </ul>

    <h2>Projects</h2>
    <table className={ui.table}><thead><tr><th>Project</th><th>Country · MW · stage</th><th>Location basis</th><th>Yield reading</th><th>Data room</th></tr></thead><tbody>
      {s.rows.map(x => <tr key={x.id}><td>{x.name}</td><td>{x.country ?? "—"} · {x.capacityMw ?? "—"} · {x.stage.replace(/_/g, " ")}</td><td>{x.located ? PRECISION[x.precision as keyof typeof PRECISION] ?? "Precision not recorded" : "Not located"}</td>
        <td>{x.yield ? `${x.yield.statedKwhPerKw} kWh/kW vs ${x.yield.tracking ? Math.round(x.yield.tracking) : "—"} tracking: ${x.yield.question}` : "—"}</td><td>{x.roomFilled}/{x.roomTotal}</td></tr>)}
    </tbody></table>

    <h2>Route to capital</h2>
    {projs.map(p => { const m = matchProgrammes(p); return <section key={p.id} className={r.read} style={{ marginBottom: 10 }}>
      <b>{p.name}</b> <span className={ui.sub}>{p.country ?? "?"}</span>
      <p className={ui.sub}>{(["credit", "equity", "derisk", "prep", "acquisition"] as const).map(l => { const list = m.filter(x => x.programme.lanes.includes(l)).map(x => x.programme.name.split(" (")[0]); return list.length ? `${LANES[l].split(" (")[0]}: ${list.slice(0, 5).join(", ")}` : null; }).filter(Boolean).join(" · ") || "No catalogued programme for this country."}</p>
    </section>; })}

    <h2>Country context</h2>
    {risks.map(c => <div key={c!.iso3}><b>{c!.iso3}</b>{(c!.note ?? COUNTRY_NOTES[c!.iso3]) && <p>{c!.note}</p>}<p className={ui.sub}>{c!.readings.map(x => `${x.label}: ${fmtReading(x)}`).join(" · ")}</p></div>)}

    <h2>Guardrails</h2>
    <p>Regenera makes project-level introductions to institutional, DFI and strategic capital only, each through the approval queue. It does not promote a sponsor&apos;s own securities; success fees are reviewed by counsel; counterparties are rescreened against sanctions lists before any introduction.</p>

    <h2>Sources</h2>
    <ul className={ui.sub}>
      <li>Sponsor documents as recorded in Regenera OS (claims marked source-provided, with document and page).</li>
      <li>PVGIS 5.3 (EU JRC, SARAH-3), fixed equator-facing and single-axis tracking, 14% losses.</li>
      <li>World Bank World Development Indicators and Worldwide Governance Indicators.</li>
      <li>OFAC SDN, UK Sanctions List, EU consolidated list, UN consolidated list (as loaded in the OS).</li>
      <li>UK Companies House public data (where checked).</li>
      <li>Public mandates of the capital programmes listed (institution websites; verify before outreach).</li>
    </ul>
  </article>;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, like, or, sql } from "drizzle-orm";
import FilterForm from "@/components/filter-form";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { specialists } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal, mandateCondition } from "@/lib/db/scoped";
import { CONFLICT_STATES, NDA_STATES, SPECIALIST_BENCH, SPECIALIST_SOURCES } from "@/lib/funding/vocab";
import { saveSpecialistAction } from "../funding-origination-actions";
import f from "../funding/funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Specialists" };

export default async function SpecialistsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/specialists");
  if (!isInternal(user.scope)) notFound();
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase();
  const rows = await appDb().select().from(specialists).where(and(mandateCondition(user.scope, specialists.mandateId),
    q ? or(like(sql`lower(${specialists.name})`, `%${q}%`), like(sql`lower(${specialists.sectors} || ${specialists.geographies} || ${specialists.countries} || ${specialists.credentials})`, `%${q}%`)) : undefined,
    sp.expertise && sp.expertise in SPECIALIST_BENCH ? like(specialists.expertise, `%"${sp.expertise}"%`) : undefined)).orderBy(asc(specialists.name));
  const open = rows.find(s => s.id === sp.open) ?? null;
  return (
    <>
      <PageHeader title="Specialists" count={rows.length} actions={<Link className="btn" href="/capacity">Capacity</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>The flexible specialist bench, activated per engagement. Rates, ratings and performance notes are internal and never appear in portals. Record where each specialist came from; no source is scraped.</p>
      <div className={ui.workspace}>
        <FilterForm action="/specialists" className={ui.filters}>
          <p className={ui.filtersTitle}>Filters</p>
          <div className={ui.field}><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="Name, sector, country, credential" /></div>
          <div className={ui.field}><label htmlFor="expertise">Bench</label><select id="expertise" name="expertise" defaultValue={sp.expertise ?? ""}><option value="">Any</option>{Object.entries(SPECIALIST_BENCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className={ui.filterActions}><button className="btn" type="submit">Apply</button><Link className={ui.clear} href="/specialists">Clear</Link></div>
        </FilterForm>
        <div>
          {rows.length === 0 ? <p className={r.empty}>No specialists yet. Add one below.</p> : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th>Specialist</th><th>Expertise</th><th>Geography · languages</th><th className={ui.num}>Rate</th><th>Availability</th><th>NDA · conflict</th><th>Source</th></tr></thead>
                <tbody>{rows.map(s => (
                  <tr key={s.id}>
                    <td className={ui.wrap}><Link className={ui.primary} href={`/specialists?open=${s.id}`}>{s.name}</Link><span className={ui.sub}>{s.credentials.slice(0, 80)}</span></td>
                    <td className={ui.wrap}>{s.expertise.map(e => SPECIALIST_BENCH[e as keyof typeof SPECIALIST_BENCH] ?? e).join(", ") || "—"}<span className={ui.sub}>{s.sectors.join(", ")}</span></td>
                    <td className={ui.wrap}>{[...s.geographies, ...s.countries].join(", ") || "—"}<span className={ui.sub}>{s.languages.join(", ")}</span></td>
                    <td className={ui.num}>{s.hourlyRate ? `${s.hourlyRate}/h` : ""}{s.dayRate ? `${s.hourlyRate ? " · " : ""}${s.dayRate}/d` : ""}{!s.hourlyRate && !s.dayRate ? "—" : ` ${s.currency}`}</td>
                    <td>{s.availability || "—"}</td>
                    <td>{NDA_STATES[s.ndaStatus as keyof typeof NDA_STATES]} · <span className={s.conflictStatus === "conflicted" ? f.warn : undefined}>{CONFLICT_STATES[s.conflictStatus as keyof typeof CONFLICT_STATES]}</span></td>
                    <td className={ui.sub}>{SPECIALIST_SOURCES[s.source as keyof typeof SPECIALIST_SOURCES] ?? s.source}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <section className={r.panel} style={{ marginTop: 14 }}>
            <p className={r.panelTitle}><span>{open ? `Edit · ${open.name}` : "Add a specialist"}</span>{open && <Link href="/specialists">New</Link>}</p>
            <form action={saveSpecialistAction} className={f.grid3}>
              {open && <input type="hidden" name="id" value={open.id} />}
              <label>Name<input name="name" required defaultValue={open?.name ?? ""} /></label>
              <label>Credentials<input name="credentials" defaultValue={open?.credentials ?? ""} /></label>
              <label>Engagement model<input name="engagementModel" defaultValue={open?.engagementModel ?? ""} placeholder="hourly, day rate, retainer…" /></label>
              <fieldset className={f.full} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 12.5 }}>
                <legend className={ui.sub}>Expertise</legend>
                {Object.entries(SPECIALIST_BENCH).map(([k, v]) => <label key={k} className={f.inline}><input type="checkbox" name="expertise" value={k} defaultChecked={open?.expertise.includes(k)} /> {v}</label>)}
              </fieldset>
              <label>Sectors<input name="sectors" defaultValue={open?.sectors.join(", ") ?? ""} /></label>
              <label>Sub-sectors<input name="subSectors" defaultValue={open?.subSectors.join(", ") ?? ""} /></label>
              <label>Geographies<input name="geographies" defaultValue={open?.geographies.join(", ") ?? ""} /></label>
              <label>Countries<input name="countries" defaultValue={open?.countries.join(", ") ?? ""} /></label>
              <label>Languages<input name="languages" defaultValue={open?.languages.join(", ") ?? ""} /></label>
              <label>Availability<input name="availability" defaultValue={open?.availability ?? ""} /></label>
              <label>Hourly rate<input name="hourlyRate" inputMode="decimal" defaultValue={open?.hourlyRate ?? ""} /></label>
              <label>Day rate<input name="dayRate" inputMode="decimal" defaultValue={open?.dayRate ?? ""} /></label>
              <label>Currency<input name="currency" maxLength={3} defaultValue={open?.currency ?? "USD"} /></label>
              <label>NDA<select name="ndaStatus" defaultValue={open?.ndaStatus ?? "none"}>{Object.entries(NDA_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Conflict check<select name="conflictStatus" defaultValue={open?.conflictStatus ?? "unchecked"}>{Object.entries(CONFLICT_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Source<select name="source" defaultValue={open?.source ?? "referral"}>{Object.entries(SPECIALIST_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Source note<input name="sourceNote" defaultValue={open?.sourceNote ?? ""} /></label>
              <label>Prior Regenera engagements<input name="priorEngagements" defaultValue={open?.priorEngagements.join(", ") ?? ""} /></label>
              <label>Internal rating (1–5)<input name="rating" inputMode="numeric" defaultValue={open?.rating ?? ""} /></label>
              <label className={f.full}>Performance notes (internal)<textarea name="performanceNotes" defaultValue={open?.performanceNotes ?? ""} /></label>
              <div><button className="btn btn--primary" type="submit">Save</button></div>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}

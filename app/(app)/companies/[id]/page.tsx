import Link from "next/link";
import { notFound } from "next/navigation";
import { EmailChip, Notice, ScoreChip } from "@/components/crm-bits";
import DossierView from "@/components/dossier-view";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { getOrganization } from "@/lib/crm/queries";
import { DEAL_STAGES, SECTORS } from "@/lib/vocab";
import { addNote, publicEnrichOne, researchOne } from "../../crm-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company" };

const SOURCE_NAME: Record<string, string> = { apollo: "Apollo", wikidata: "Wikidata", gleif: "GLEIF", sec: "SEC", nominatim: "OpenStreetMap", manual: "Manual", site: "regenera.bio", gdelt: "GDELT", ted: "TED", worldbank: "World Bank", edgar_form_d: "SEC Form D", gdacs: "GDACS", csv: "CSV" };

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/companies/${id}`);
  const sp = await searchParams;
  const data = await getOrganization(user.scope, id);
  if (!data) notFound();
  const { org, people, triggers, deals, timeline, dossier, segment } = data;
  const fs = org.fieldSources ?? {};
  const prov = (f: string) => (fs[f] ? <span className={r.prov}> · {SOURCE_NAME[fs[f].source] ?? fs[f].source}</span> : null);
  const hasAi = aiConfig() !== null;

  return (
    <>
      <Notice text={sp.notice} />
      <header className={r.head}>
        <div>
          <p className={r.kicker}>Company{segment ? ` · ${segment.name}` : ""}</p>
          <h1 className={r.title}>{org.name}</h1>
          <p className={r.meta}>
            {org.domain && <a href={`https://${org.domain}`} target="_blank" rel="noreferrer">{org.domain}</a>}
            {org.location && <span>{org.location}</span>}
            {org.sector && <span className={`${ui.chip} ${ui.chipReed}`}>{SECTORS[org.sector as keyof typeof SECTORS] ?? org.sector}</span>}
            {triggers.length > 0 && <span className={`${ui.chip} ${ui.chipEmber}`}>{triggers.length} current trigger{triggers.length > 1 ? "s" : ""}</span>}
          </p>
        </div>
        <div className={r.actions}>
          {org.lat != null && <Link className="btn" href="/map">On the map</Link>}
          <form action={publicEnrichOne}><input type="hidden" name="orgId" value={org.id} /><button className="btn" type="submit">Enrich (free sources)</button></form>
          <form action={researchOne}><input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="depth" value="full" /><button className="btn btn--primary" type="submit" disabled={!hasAi} title={hasAi ? "" : "Set ANTHROPIC_API_KEY"}>Research</button></form>
        </div>
      </header>

      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Dossier</span>{dossier && <span>{dossier.status}</span>}</p>
            {dossier ? <DossierView status={dossier.status} fields={dossier.fields} refreshedAt={dossier.refreshedAt} depth={dossier.depth} /> : <p className={r.empty}>No dossier yet. Research reads the company&apos;s website and this year&apos;s news, filings and tenders, and cites a source for every fact.</p>}
          </section>

          {triggers.length > 0 && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Current triggers</p>
              {triggers.map(t => (
                <div key={t.id} style={{ marginBottom: 12 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{t.summary}</p>
                  <p className={r.meta} style={{ margin: "2px 0 6px" }}><span className={ui.chip}>{t.type}</span><span>{t.eventDate}</span><span>urgency {t.urgency}/5</span>{t.sourceUrl && <a href={t.sourceUrl} target="_blank" rel="noreferrer">source</a>}</p>
                  {t.decisionRead && <p className={r.read}>{t.decisionRead}</p>}
                </div>
              ))}
            </section>
          )}

          <section className={r.panel}>
            <p className={r.panelTitle}><span>People</span><Link href={`/people?org=${org.id}`}>View all</Link></p>
            {people.length === 0 ? <p className={r.empty}>No people saved. Use Find in Apollo with this company&apos;s domain.</p> : (
              <table className={ui.table}><tbody>
                {people.map(p => (
                  <tr key={p.id}>
                    <td><Link className={ui.primary} href={`/people/${p.id}`}>{p.fullName}</Link><span className={ui.sub}>{p.title}</span></td>
                    <td><EmailChip status={p.emailStatus} /></td>
                    <td><ScoreChip score={p.score} tier={p.tier} /></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Activity</p>
            <form action={addNote} className={r.form} style={{ marginBottom: 12 }}>
              <input type="hidden" name="entity" value="organization" /><input type="hidden" name="id" value={org.id} />
              <textarea name="text" placeholder="Add a note" aria-label="Note" required />
              <button className="btn" type="submit">Add note</button>
            </form>
            {timeline.length === 0 ? <p className={r.empty}>No activity yet.</p> : (
              <ul className={r.timeline}>{timeline.map(a => <li key={a.id}><span className={r.when}>{a.occurredAt.slice(0, 10)}</span><span className={r.what}><b>{a.type.replace(/_/g, " ")}</b> {a.detail}</span></li>)}</ul>
            )}
          </section>
        </div>

        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Identity</p>
            <dl className={r.kv}>
              <dt>Legal entity</dt><dd>{org.lei ? <a href={`https://search.gleif.org/#/record/${org.lei}`} target="_blank" rel="noreferrer">{org.lei}</a> : "—"}{prov("lei")}</dd>
              <dt>Wikidata</dt><dd>{org.wikidataId ? <a href={`https://www.wikidata.org/wiki/${org.wikidataId}`} target="_blank" rel="noreferrer">{org.wikidataId}</a> : "—"}{prov("wikidataId")}</dd>
              <dt>SEC CIK</dt><dd>{org.secCik ? <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${org.secCik}`} target="_blank" rel="noreferrer">{org.secCik}</a> : "—"}{prov("secCik")}</dd>
              <dt>Website</dt><dd>{org.website ?? (org.domain ? `https://${org.domain}` : "—")}{prov("website")}</dd>
              <dt>Industry</dt><dd>{org.industry ?? "—"}{prov("industry")}</dd>
              <dt>Headcount</dt><dd>{org.headcount ?? "—"}{prov("headcount")}</dd>
              <dt>Map</dt><dd>{org.lat != null ? `${org.lat.toFixed(3)}, ${org.lng?.toFixed(3)}` : "Locating…"}{prov("lat")}</dd>
              <dt>Source</dt><dd>{org.source}</dd>
            </dl>
            {org.description && <p className={r.why} style={{ marginTop: 10 }}>{org.description}</p>}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Deals</p>
            {deals.length === 0 ? <p className={r.empty}>No deals.</p> : deals.map(d => (
              <p key={d.id} style={{ margin: "0 0 8px", fontSize: 13 }}><b>{d.name}</b><br /><span className={ui.chip}>{DEAL_STAGES[d.stage as keyof typeof DEAL_STAGES]}</span> {d.engagement.replace(/_/g, " ")}</p>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}

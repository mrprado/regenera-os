import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contacts, organizations, triggers } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { apolloConfig } from "@/lib/config";
import { checkConflicts, type Conflict } from "@/lib/crm/conflicts";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { activeSequencesForPicker } from "@/lib/outreach/queries";
import { SourceError } from "@/lib/sources/http";
import { findPeopleForTrigger, suggestedTitles, type TriggerPeople } from "@/lib/triggers/pursue";
import { pursueAction } from "../actions";
import Assessment from "./assessment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pursue trigger" };

function Conflicts({ items }: { items: Conflict[] }) {
  if (!items.length) return <p className={ui.sub} style={{ marginTop: 0 }}>Conflict check: clear.</p>;
  return (
    <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13.5 }}>
      {items.map((c, i) => <li key={i} style={{ color: c.blocking ? "#b0432f" : undefined }}>{c.blocking ? "Blocks enrollment: " : ""}{c.detail}</li>)}
    </ul>
  );
}

export default async function PursuePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/triggers");
  const { id } = await params;
  const sp = await searchParams;
  const db = appDb();
  const [t] = await db.select().from(triggers).where(and(eq(triggers.id, id), mandateCondition(user.scope, triggers.mandateId)));
  if (!t) notFound();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, t.orgId));
  const saved = await db.select({ id: contacts.id, fullName: contacts.fullName, title: contacts.title, email: contacts.email, emailStatus: contacts.emailStatus, leadState: contacts.leadState })
    .from(contacts).where(eq(contacts.sourceTriggerId, t.id));
  const cfg = apolloConfig();
  let found: TriggerPeople | null = null;
  let error = "";
  if (cfg) {
    try { found = await findPeopleForTrigger(db, cfg, t.id); }
    catch (e) { error = e instanceof SourceError ? e.message : "Apollo search failed. Try again in a minute."; }
  }
  const conflicts = found?.conflicts ?? await checkConflicts(db, t.mandateId, { orgId: t.orgId });
  const seqs = await activeSequencesForPicker(user.scope);
  const targeted = seqs.find(s => s.tier === "targeted");
  const titles = suggestedTitles(t);

  return (
    <>
      <PageHeader title={org?.name ?? "Trigger"} actions={<Link className="btn" href="/triggers">All triggers</Link>} />
      <Notice text={sp.notice} />
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Trigger</span><span className={ui.chip}>{t.type} · {t.status}</span></p>
            <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{t.summary}</p>
            <p className={ui.sub}>{t.eventDate} · {t.source}{t.sourceUrl ? <> · <a href={t.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</p>
            {t.decisionRead && <p className={ui.read}>{t.decisionRead}</p>}
          </section>

          <Assessment triggerId={t.id} />

          <section className={r.panel}>
            <p className={r.panelTitle}><span>People at {org?.name}</span><span className={ui.sub} style={{ margin: 0 }}>Apollo search, 0 credits</span></p>
            <Conflicts items={conflicts} />
            {!cfg && <p className={r.empty}>Set APOLLO_API_KEY (free plan) to search for people here. You can still add people by hand from the company record.</p>}
            {error && <p className={ui.notice}>{error}</p>}
            {found && found.people.length === 0 && <p className={r.empty}>Apollo has no people for this organization{org?.domain ? ` (${org.domain})` : ""}. Add someone by hand from the company record.</p>}
            {found && found.people.length > 0 && (
              <form action={pursueAction}>
                <input type="hidden" name="triggerId" value={t.id} />
                <p className={ui.sub} style={{ marginTop: 0 }}>
                  {found.searchedBy === "titles" ? `Matched on the suggested titles: ${titles.join(", ")}.` : "No match on the suggested titles, showing decision makers by seniority."}
                </p>
                <div className={ui.tableWrap} style={{ marginBottom: 12 }}>
                  <table className={ui.table}>
                    <thead><tr><th style={{ width: 28 }}><span className="sr-only">Select</span></th><th>Name</th><th>Title</th><th>Location</th><th /></tr></thead>
                    <tbody>
                      {found.people.map(p => {
                        const name = p.name || [p.first_name, p.last_name ?? p.last_name_obfuscated].filter(Boolean).join(" ");
                        const pick = JSON.stringify({ id: p.id, first_name: p.first_name, last_name: p.last_name, name: p.name, title: p.title, seniority: p.seniority, linkedin_url: p.linkedin_url, city: p.city, country: p.country });
                        return (
                          <tr key={p.id}>
                            <td><input type="checkbox" name="pick" value={pick} aria-label={`Select ${name}`} disabled={!!p.inCrm} /></td>
                            <td><span className={ui.primary}>{name}</span>{p.linkedin_url && <a className={ui.sub} href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}</td>
                            <td className={ui.wrap}>{p.title ?? "—"}</td>
                            <td>{[p.city, p.country].filter(Boolean).join(", ") || "—"}</td>
                            <td>{p.inCrm ? <Link href={`/people/${p.inCrm}`}>In the CRM</Link> : null}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={ui.rowActions} style={{ alignItems: "center" }}>
                  <select name="sequenceId" aria-label="Sequence" defaultValue={targeted?.id ?? ""} style={{ height: 32, borderRadius: 999, border: "1px solid var(--line)", fontSize: 13, padding: "0 10px" }}>
                    <option value="">Save only, no sequence</option>{seqs.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select>
                  <label style={{ fontSize: 13 }}><input type="checkbox" name="enrich" value="1" /> Find emails with Apollo (1 credit each when found)</label>
                  {conflicts.some(c => c.blocking) && <label style={{ fontSize: 13, color: "#b0432f" }}><input type="checkbox" name="override" value="1" /> I checked the conflicts, enroll anyway</label>}
                  <button className="btn btn--primary" type="submit">Pursue</button>
                </div>
                <p className={ui.sub}>Without Apollo credits, addresses are inferred for free from the organization&apos;s known email pattern when two or more addresses are already on record. Every draft still waits in the approval queue.</p>
              </form>
            )}
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Found for this trigger</p>
            {saved.length === 0 ? <p className={r.empty}>Nobody saved yet.</p> : (
              <ul className={r.timeline}>{saved.map(c => (
                <li key={c.id}><span className={r.when}>{c.leadState}</span><span><Link href={`/people/${c.id}`}>{c.fullName}</Link>{c.title ? `, ${c.title}` : ""}<span className={ui.sub}>{c.email ?? "No address yet"}</span></span></li>
              ))}</ul>
            )}
          </section>
          {org && (
            <section className={r.panel}>
              <p className={r.panelTitle}><span>Organization</span><Link href={`/companies/${org.id}`}>Record</Link></p>
              <dl className={r.kv}>
                <dt>Domain</dt><dd>{org.domain ?? "—"}</dd>
                <dt>Location</dt><dd>{org.location ?? org.country ?? "—"}</dd>
                <dt>Source</dt><dd>{org.source}</dd>
              </dl>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

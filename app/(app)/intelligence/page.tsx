import Link from "next/link";
import { and, asc, desc, inArray, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contacts, organizations, signalAssessments, theses, triggers } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { watchFeed } from "@/lib/intelligence/engine";
import { RATINGS, RELEVANCE_DIMENSIONS, SIGNAL_TYPES, THESIS_THEMES, WATCH_EVENTS, WATCH_KINDS } from "@/lib/intelligence/vocab";
import { addThesisAction, addWatchAction, reviewWatchAction } from "../intelligence-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watch & theses" };
const TABS = [["watch", "Institution & person watch"], ["signals", "Assessed signals"], ["theses", "Theses"]] as const;

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/intelligence");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "watch";
  const db = appDb();
  const [orgs, people] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1500),
    db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(mandateCondition(user.scope, contacts.mandateId)).orderBy(asc(contacts.fullName)).limit(1500),
  ]);
  const oname = new Map(orgs.map(o => [o.id, o.name]));
  return (
    <>
      <PageHeader title="Watch & theses" />
      <Notice text={sp.notice} />
      <p className={ui.sub}>Intelligence turns external signals into Regenera knowledge: what changed, why it matters, which projects, relationships and services it touches, what Regenera did, and what was learned. Person watches cover professional activity only. The raw signal stream is in <Link href="/triggers">Intelligence</Link>.</p>
      <nav className={ui.tabs} aria-label="Intelligence sections">{TABS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/intelligence?tab=${k}`}>{l}</Link>)}</nav>
      {tab === "watch" && <Watch mandateIds={user.scope.mandateIds} orgs={orgs} people={people} />}
      {tab === "signals" && <Signals scope={user.scope} oname={oname} />}
      {tab === "theses" && <Theses scope={user.scope} orgs={orgs} oname={oname} />}
    </>
  );
}

async function Watch({ mandateIds, orgs, people }: { mandateIds: string[]; orgs: { id: string; name: string }[]; people: { id: string; name: string | null }[] }) {
  const feed = await watchFeed(appDb(), mandateIds);
  return <div className={r.grid}>
    <section className={r.panel}><p className={r.panelTitle}>What changed</p>
      {feed.length === 0 ? <p className={r.empty}>No watches yet. Add strategic institutions and people on the right.</p> : feed.map(f => <div key={f.watch.id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
        <p style={{ margin: 0 }}><b>{f.watch.label}</b> <span className={ui.chip}>{WATCH_KINDS[f.watch.kind]}</span> <span className={ui.sub}>{f.watch.reason}{f.watch.events.length ? ` · events: ${f.watch.events.map(e => WATCH_EVENTS[e as keyof typeof WATCH_EVENTS] ?? e).join(", ")}` : ""}</span></p>
        {f.items.length === 0 ? <p className={r.empty}>Nothing new since {f.watch.lastReviewedAt?.slice(0, 10) ?? "90 days ago"}.</p> : <ul>{f.items.map(t => <li key={t.id}><Link href={`/triggers/${t.id}`}>{t.summary}</Link> <span className={ui.sub}>{t.eventDate} · {t.type}{t.assessment ? ` · why it matters: ${t.assessment.interpretation.whyItMatters || "not yet interpreted"}` : " · not yet assessed"}</span></li>)}</ul>}
        <form action={reviewWatchAction}><input type="hidden" name="watchId" value={f.watch.id} /><button className={ui.miniBtn} type="submit">Mark reviewed</button></form>
      </div>)}
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Add watch</p>
      <form action={addWatchAction} className={r.form}>
        <label>Kind<select name="kind" defaultValue="institution"><option value="institution">Institution</option><option value="person">Person (professional activity only)</option></select></label>
        <label>Institution<select name="orgId" defaultValue=""><option value="">—</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Person<select name="contactId" defaultValue=""><option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Label<input name="label" required /></label><label>Why watch<input name="reason" /></label>
        <fieldset style={{ border: 0, padding: 0 }}><legend className={ui.sub}>Events of interest</legend>{Object.entries(WATCH_EVENTS).map(([k, v]) => <label key={k} style={{ display: "flex", gap: 6, fontWeight: 400 }}><input type="checkbox" name="events" value={k} style={{ width: "auto" }} />{v}</label>)}</fieldset>
        <button className="btn" type="submit">Add</button></form></section></aside>
  </div>;
}

async function Signals({ scope, oname }: { scope: Parameters<typeof mandateCondition>[0]; oname: Map<string, string> }) {
  const as = await appDb().select().from(signalAssessments).where(mandateCondition(scope, signalAssessments.mandateId)).orderBy(desc(signalAssessments.updatedAt)).limit(100);
  const ts = as.length ? await appDb().select({ id: triggers.id, summary: triggers.summary, orgId: triggers.orgId, eventDate: triggers.eventDate }).from(triggers).where(inArray(triggers.id, as.map(a => a.triggerId))) : [];
  const high = (a: (typeof as)[number]) => a.relevance.filter(x => x.rating === "high").map(x => RELEVANCE_DIMENSIONS[x.dimension as keyof typeof RELEVANCE_DIMENSIONS]);
  return <section className={r.panel}><p className={r.panelTitle}>Assessed signals</p>
    {as.length === 0 ? <p className={r.empty}>No signals assessed yet. Open a signal in Intelligence and assess it.</p> : <table className={ui.table}><thead><tr><th>Signal</th><th>Type</th><th>High on</th><th>Actions</th><th>Learning</th></tr></thead><tbody>
      {as.map(a => { const t = ts.find(x => x.id === a.triggerId); return <tr key={a.id}><td className={ui.primary}><Link href={`/triggers/${a.triggerId}`}>{t?.summary ?? "—"}</Link><span className={ui.sub}>{t ? `${oname.get(t.orgId) ?? ""} · ${t.eventDate}` : ""}</span></td><td>{SIGNAL_TYPES[a.signalType]}</td><td className={ui.sub}>{high(a).join(", ") || "—"}</td><td className={ui.sub}>{a.actions.map(x => `${x.action.replace(/_/g, " ")} (${x.status})`).join(", ") || "—"}</td><td className={ui.sub}>{a.learning || "—"}</td></tr>; })}
    </tbody></table>}
    <p className={ui.sub}>Ratings: {Object.values(RATINGS).join(" · ")}. Derived ratings come from Regenera&apos;s records; people rate the rest.</p>
  </section>;
}

async function Theses({ scope, orgs, oname }: { scope: Parameters<typeof mandateCondition>[0]; orgs: { id: string; name: string }[]; oname: Map<string, string> }) {
  const ts = await appDb().select().from(theses).where(mandateCondition(scope, theses.mandateId)).orderBy(desc(theses.createdAt));
  return <div className={r.grid}>
    <section className={r.panel}><p className={r.panelTitle}>Theses</p>
      {ts.length === 0 ? <p className={r.empty}>No theses recorded.</p> : <table className={ui.table}><thead><tr><th>Who</th><th>Theme</th><th>Thesis</th><th>Evidence</th><th>Contradictions · interpretation</th></tr></thead><tbody>
        {ts.map(t => <tr key={t.id}><td>{t.orgId ? oname.get(t.orgId) ?? "—" : "—"}</td><td>{THESIS_THEMES[t.theme]}</td><td>{t.thesis}<span className={ui.sub}>{[t.sectors.join(", "), t.geography].filter(Boolean).join(" · ")}</span></td><td className={ui.sub}>{t.sourceUrl ? <a href={t.sourceUrl} target="_blank" rel="noreferrer">{t.evidence || "source"}</a> : t.evidence || "—"}{t.date ? ` · ${t.date}` : ""}</td><td className={ui.sub}>{[t.contradictions, t.interpretation].filter(Boolean).join(" · ") || "—"}</td></tr>)}
      </tbody></table>}
      <p className={ui.sub}>Thesis vs what an institution actually finances is shown on each capital partner&apos;s page.</p>
    </section>
    <aside><section className={r.panel}><p className={r.panelTitle}>Record a thesis</p>
      <form action={addThesisAction} className={r.form}>
        <label>Institution<select name="orgId" defaultValue=""><option value="">—</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label>Theme<select name="theme">{Object.entries(THESIS_THEMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Thesis<textarea name="thesis" rows={3} required /></label><label>Sectors<input name="sectors" /></label><label>Geography<input name="geography" /></label>
        <label>Evidence<input name="evidence" /></label><label>Source URL<input name="sourceUrl" type="url" /></label><label>Date<input name="date" type="date" /></label><label>Implications<input name="implications" /></label>
        <button className="btn" type="submit">Add</button></form></section></aside>
  </div>;
}

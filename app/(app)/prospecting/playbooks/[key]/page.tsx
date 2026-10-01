import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { playbookDrafts, savedSearches, segments, sequences } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { buildPlaybook, PLAYBOOK_STEPS, REGIONS } from "@/lib/radar/playbooks";
import CopyButton from "../../copy-button";
import { draftPlaybookAction, playbookSequenceAction, runSearchNowAction, savePlaybookTemplateAction } from "../../../radar-actions";
import styles from "../../prospecting.module.css";
import { fundingForKeywords } from "@/lib/funding/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playbook" };

const CHANNEL: Record<string, string> = { email: "Email", linkedin_connect: "LinkedIn connection note", linkedin_message: "LinkedIn message" };

export default async function PlaybookPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/prospecting");
  const { key } = await params;
  const sp = await searchParams;
  const db = appDb();
  const [seg] = await db.select().from(segments).where(eq(segments.key, key));
  if (!seg) notFound();
  const region = sp.region && REGIONS[sp.region] ? sp.region : undefined;
  const pb = buildPlaybook(seg, region);
  const drafts = await db.select().from(playbookDrafts).where(and(eq(playbookDrafts.segmentId, seg.id), mandateCondition(user.scope, playbookDrafts.mandateId))).orderBy(asc(playbookDrafts.step));
  const [search] = await db.select().from(savedSearches).where(and(eq(savedSearches.key, `seg:${key}`), mandateCondition(user.scope, savedSearches.mandateId)));
  const funding = await fundingForKeywords(user.scope, pb.keywords.topics);
  const [seq] = await db.select({ id: sequences.id }).from(sequences).where(and(inArray(sequences.key, [`pb:${key}`]), mandateCondition(user.scope, sequences.mandateId)));

  return (
    <>
      <PageHeader title={pb.name} actions={<Link className="btn" href={`/prospecting${region ? `?region=${region}` : ""}`}>All playbooks</Link>} />
      <Notice text={sp.notice} />
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}>The message</p>
            <p className={styles.oneLiner}>{pb.message.oneLiner}</p>
            <dl className={r.kv} style={{ marginTop: 10 }}>
              <dt>Why Regenera</dt><dd>{pb.message.whyRegenera}</dd>
              <dt>Why now</dt><dd>{pb.message.whyNow}</dd>
              <dt>Entry offer</dt><dd>{pb.message.offer}</dd>
              <dt>The ask</dt><dd>{pb.message.ask}</dd>
            </dl>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>
              <span>Message and sequence templates</span>
              <span className={ui.rowActions}>
                <form action={draftPlaybookAction}><input type="hidden" name="segmentId" value={seg.id} /><input type="hidden" name="key" value={key} /><button className={ui.miniBtn} type="submit">{drafts.length ? "Rewrite with Claude" : "Write with Claude"}</button></form>
                {drafts.length > 0 && <form action={playbookSequenceAction}><input type="hidden" name="segmentId" value={seg.id} /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">{seq ? "Update the sequence" : "Use as sequence"}</button></form>}
              </span>
            </p>
            {drafts.length === 0 ? (
              <>
                <p className={r.empty}>No templates yet. Claude writes one per step from this playbook, checked against house style. You edit them here, then turn them into a sequence.</p>
                <ol style={{ fontSize: 13, paddingLeft: 18 }}>{PLAYBOOK_STEPS.map(s => <li key={s.step}>Day {s.day}, {CHANNEL[s.channel]}: {s.purpose}</li>)}</ol>
              </>
            ) : (
              <div className={styles.steps}>
                {drafts.map(d => (
                  <form key={d.id} action={savePlaybookTemplateAction} className={styles.step}>
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="key" value={key} />
                    <div className={styles.stepHead}><span>Step {d.step + 1} · day {d.day} · {CHANNEL[d.channel]}</span><CopyButton text={d.channel === "email" ? `${d.subject}\n\n${d.body}` : d.body} /></div>
                    <p className={ui.sub} style={{ marginTop: 0 }}>{d.purpose}</p>
                    {d.channel === "email" && <input name="subject" defaultValue={d.subject} aria-label="Subject" style={{ marginBottom: 6 }} />}
                    <textarea name="body" defaultValue={d.body} aria-label="Template" />
                    {d.styleIssues?.length ? <p className={ui.sub} style={{ color: "#b0432f" }}>{d.styleIssues.map(i => i.detail).join(" ")}</p> : null}
                    <button className={ui.miniBtn} type="submit" style={{ marginTop: 6 }}>Save</button>
                  </form>
                ))}
              </div>
            )}
            <p className={ui.sub}>Placeholders {"{first_name}"}, {"{organization}"} and {"{trigger}"} are filled per person when the sequence drafts are written. Every personal draft still waits in the approval queue.</p>
          </section>
        </div>

        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Open funding for this playbook</span><Link href={`/funding?q=${encodeURIComponent(pb.keywords.topics[0] ?? "")}`}>Funding</Link></p>
            {funding.length === 0 ? <p className={r.empty}>No open grants, calls or tenders match these keywords yet.</p> : (
              <ul className={r.timeline}>{funding.map(f => (
                <li key={f.id}><span className={r.when}>{f.deadline ?? "deadline unknown"}</span><span><Link href={`/funding/${f.id}`}>{f.title}</Link>{f.funder ? ` · ${f.funder}` : ""}</span></li>
              ))}</ul>
            )}
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Who to reach</p>
            <dl className={r.kv}>
              <dt>Titles</dt><dd>{pb.who.titles.join(", ")}</dd>
              <dt>Organizations</dt><dd>{pb.who.companyTypes.join(", ")}</dd>
              <dt>Sectors</dt><dd>{pb.who.sectors.join(", ")}</dd>
              <dt>Keywords</dt><dd>{pb.keywords.topics.join(", ")}</dd>
            </dl>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Searches{region ? ` · ${region.replace("_", " ")}` : ""}</p>
            <div className={styles.links}>
              <a href={pb.searches.linkedinPeople} target="_blank" rel="noreferrer">LinkedIn people</a>
              <a href={pb.searches.linkedinCompanies} target="_blank" rel="noreferrer">LinkedIn companies</a>
              <a href={pb.searches.googlePeople} target="_blank" rel="noreferrer">Google people</a>
              <a href={pb.searches.googleCompanies} target="_blank" rel="noreferrer">Google companies</a>
              <a href={pb.searches.salesNavigator} target="_blank" rel="noreferrer">Sales Navigator</a>
            </div>
            <p className={ui.sub}>People Boolean</p>
            <div className={styles.code}>{pb.searches.peopleBoolean}</div>
            <div style={{ margin: "4px 0 8px" }}><CopyButton text={pb.searches.peopleBoolean} /></div>
            <p className={ui.sub}>Company Boolean</p>
            <div className={styles.code}>{pb.searches.companyBoolean}</div>
            <div style={{ margin: "4px 0 8px" }}><CopyButton text={pb.searches.companyBoolean} /></div>
            {search && (
              <form action={runSearchNowAction}><input type="hidden" name="id" value={search.id} />
                <button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Run Apollo search now (free)</button>
                <span className={ui.sub}>{search.lastRunAt ? `Last run ${search.lastRunAt.slice(0, 10)}, ${search.lastNew ?? 0} new` : "Not run yet"}</span>
              </form>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

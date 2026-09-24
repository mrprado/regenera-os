import Link from "next/link";
import { notFound } from "next/navigation";
import { EmailChip, Notice, ScoreChip } from "@/components/crm-bits";
import DossierView from "@/components/dossier-view";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { getContact } from "@/lib/crm/queries";
import { DEAL_STAGES, ENGAGEMENTS, PRACTICES } from "@/lib/vocab";
import { addNote, pasteLinkedin, researchOne, sendEmail } from "../../crm-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Person" };

type Match = { primary?: { engagement_path: string; practice: string; engagement: string; offer: string; angle: string }; rationale?: string };
type Screening = { readiness?: Record<string, { level: string; evidence: string }>; alignment?: string; alignment_reason?: string };

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/people/${id}`);
  const sp = await searchParams;
  const data = await getContact(user.scope, id);
  if (!data) notFound();
  const { contact: c, org, score, timeline, deals, dossier } = data;
  const match = (score?.match ?? null) as Match | null;
  const screening = (score?.screening ?? null) as Screening | null;
  const hasAi = aiConfig() !== null;

  return (
    <>
      <Notice text={sp.notice} />
      <header className={r.head}>
        <div>
          <p className={r.kicker}>Person · {c.leadState}</p>
          <h1 className={r.title}>{c.fullName}</h1>
          <p className={r.meta}>
            {c.title && <span>{c.title}</span>}
            {org && <Link href={`/companies/${org.id}`}>{org.name}</Link>}
            {c.location && <span>{c.location}</span>}
            <ScoreChip score={c.score} tier={c.tier} />
          </p>
        </div>
        <div className={r.actions}>
          {c.linkedinUrl && <a className="btn" href={c.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}
          {org && <form action={researchOne}><input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="contactId" value={c.id} /><input type="hidden" name="back" value={`/people/${c.id}`} /><button className="btn btn--primary" type="submit" disabled={!hasAi}>Research</button></form>}
        </div>
      </header>

      <div className={r.grid}>
        <div>
          {score && (
            <section className={r.panel}>
              <p className={r.panelTitle}><span>Score and match</span><span>{score.scoredAt.slice(0, 10)}</span></p>
              <div className={r.scoreGrid}>
                <div className={r.scoreCell}><span>Fit (40%)</span><b>{score.fit}</b></div>
                <div className={r.scoreCell}><span>Trigger (35%)</span><b>{score.trigger}</b></div>
                <div className={r.scoreCell}><span>Access (25%)</span><b>{score.access}</b></div>
              </div>
              <p className={r.why}><b>Fit:</b> {score.rationale.fit}</p>
              <p className={r.why}><b>Trigger:</b> {score.rationale.trigger}</p>
              <p className={r.why}><b>Access:</b> {score.rationale.access}</p>
              {match?.primary && (
                <div className={r.fieldRow} style={{ marginTop: 10 }}>
                  <span className={r.fieldLabel}>Entry engagement</span>
                  <span className={r.fieldValue}>
                    <b>{ENGAGEMENTS[match.primary.engagement as keyof typeof ENGAGEMENTS] ?? match.primary.engagement}</b> · {PRACTICES[match.primary.practice as keyof typeof PRACTICES] ?? match.primary.practice}
                    <span className={r.sources}>Offer: {match.primary.offer}</span>
                    <span className={r.sources}>Angle: {match.primary.angle}</span>
                  </span>
                </div>
              )}
              {screening?.readiness && (
                <div className={r.fieldRow}>
                  <span className={r.fieldLabel}>Screening · {score.screeningQuadrant}</span>
                  <span className={r.fieldValue}>
                    {Object.entries(screening.readiness).map(([k, v]) => <span key={k} className={r.sources} style={{ marginTop: 0 }}><b style={{ textTransform: "capitalize" }}>{k}</b>: {v.level} · {v.evidence}</span>)}
                    <span className={r.sources}>Alignment {screening.alignment}: {screening.alignment_reason}</span>
                  </span>
                </div>
              )}
            </section>
          )}

          <section className={r.panel}>
            <p className={r.panelTitle}><span>Email</span><span>{c.email ?? "no address"}</span></p>
            <form action={sendEmail} className={r.form}>
              <input type="hidden" name="contactId" value={c.id} />
              <input name="subject" placeholder="Subject" aria-label="Subject" required maxLength={200} />
              <textarea name="body" placeholder="Open with their situation and the decision they hold. One concrete idea. One small ask. 120 words or fewer on first touch." aria-label="Message" required style={{ marginTop: 8, minHeight: 140 }} />
              {c.emailStatus !== "verified_provider" && c.emailStatus !== "verified_manual" && (
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontWeight: 500 }}><input type="checkbox" name="confirmUnverified" style={{ width: "auto" }} /> Send to an unverified address</label>
              )}
              <button className="btn btn--primary" type="submit" disabled={!c.email}>Send from primary mailbox</button>
              <p className={r.why}>Checked before sending: house style, suppression, mandate rules, and (outside production) the test-domain allowlist.</p>
            </form>
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Organization dossier</p>
            {dossier ? <DossierView status={dossier.status} fields={dossier.fields} refreshedAt={dossier.refreshedAt} depth={dossier.depth} /> : <p className={r.empty}>No dossier yet.</p>}
          </section>

          <section className={r.panel}>
            <p className={r.panelTitle}>Activity</p>
            <form action={addNote} className={r.form} style={{ marginBottom: 12 }}>
              <input type="hidden" name="entity" value="contact" /><input type="hidden" name="id" value={c.id} />
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
            <p className={r.panelTitle}>Contact</p>
            <dl className={r.kv}>
              <dt>Email</dt><dd>{c.email ?? "—"} <EmailChip status={c.emailStatus} /></dd>
              <dt>Seniority</dt><dd>{c.seniority ?? "—"}</dd>
              <dt>Source</dt><dd>{c.source}</dd>
              <dt>Consent basis</dt><dd>{c.consentBasis.replace(/_/g, " ")}</dd>
              <dt>Suppressed</dt><dd>{c.suppressed ? "Yes" : "No"}</dd>
            </dl>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>LinkedIn profile</p>
            <form action={pasteLinkedin} className={r.form}>
              <input type="hidden" name="id" value={c.id} />
              <textarea name="text" defaultValue={c.linkedinProfileText ?? ""} placeholder="Paste the visible profile text from a profile you are viewing. The OS never crawls LinkedIn." aria-label="LinkedIn profile text" required />
              <button className="btn" type="submit">Save</button>
            </form>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Deals</p>
            {deals.length === 0 ? <p className={r.empty}>No deals.</p> : deals.map(d => <p key={d.id} style={{ margin: "0 0 8px", fontSize: 13 }}><b>{d.name}</b> <span className={ui.chip}>{DEAL_STAGES[d.stage as keyof typeof DEAL_STAGES]}</span></p>)}
          </section>
        </aside>
      </div>
    </>
  );
}

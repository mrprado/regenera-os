import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { brokerProfiles, deals, generatedDocuments, objectives, organizations, portalUsers, projects } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { openPlaceholders, TEMPLATES } from "@/lib/documents/library";
import { commercialMarkdown } from "@/lib/documents/commercial";
import { generateAction } from "../../generator-actions";
import styles from "../../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document generator" };

const GROUPS = ["Commercial", "Confidentiality", "Engagement", "Introducers and partners", "Capital", "Information", "Reports"] as const;

export default async function GeneratorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/documents/generator");
  const sp = await searchParams;
  const t = TEMPLATES.find(x => x.key === sp.template);
  const db = appDb();
  const [docs, ps, os, bs, ds, obs] = await Promise.all([
    db.select().from(generatedDocuments).where(mandateCondition(user.scope, generatedDocuments.mandateId)).orderBy(desc(generatedDocuments.createdAt)).limit(100),
    t?.entity === "project" ? db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)) : [],
    t?.entity === "organization" ? db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000) : [],
    t?.entity === "broker" ? db.select({ id: brokerProfiles.id, name: portalUsers.name, email: portalUsers.email }).from(brokerProfiles).innerJoin(portalUsers, eq(portalUsers.id, brokerProfiles.portalUserId)).where(mandateCondition(user.scope, brokerProfiles.mandateId)) : [],
    t?.entity === "deal" ? db.select({ id: deals.id, name: deals.name }).from(deals).where(and(mandateCondition(user.scope, deals.mandateId), isNull(deals.archivedAt))).orderBy(asc(deals.name)).limit(1000) : [],
    t?.entity === "objective" ? db.select({ id: objectives.id, name: objectives.title }).from(objectives).where(mandateCondition(user.scope, objectives.mandateId)).orderBy(asc(objectives.title)).limit(1000) : [],
  ]);
  const entities = t?.entity === "project" ? ps : t?.entity === "organization" ? os : t?.entity === "broker" ? bs.map(b => ({ id: b.id, name: b.name || b.email })) : t?.entity === "deal" ? ds : t?.entity === "objective" ? obs : [];
  // Commercial documents opened from a record's Generate menu: preview what the draft will contain and what is missing.
  const chosen = sp.entity && entities.some(e => e.id === sp.entity) ? sp.entity : null;
  const preview = chosen && t?.group === "Commercial" ? await commercialMarkdown(db, t.key, chosen, new Date().toISOString().slice(0, 10)) : null;
  const missing = preview ? [...new Set(openPlaceholders(preview.md))] : [];

  return (
    <>
      <PageHeader title="Document generator" actions={<Link className="btn" href="/documents">Documents</Link>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -4 }}>Template types with structured fields, rendered as branded PDF or DOCX. Legal templates begin &quot;DRAFT — COUNSEL REVIEW REQUIRED&quot; and carry a watermark until an owner records counsel&apos;s approval; nothing here is a legal conclusion. Empty fields show as [TO CONFIRM].</p>
      <div className={r.grid}>
        <div>
          {GROUPS.map(g => (
            <section key={g} className={r.panel}>
              <p className={r.panelTitle}>{g}</p>
              <div className={styles.checks}>{TEMPLATES.filter(x => x.group === g).map(x => <Link key={x.key} href={`/documents/generator?template=${x.key}`} className={ui.chip} style={{ fontWeight: x.key === t?.key ? 700 : 400 }}>{x.name}{x.legal ? " ⚖" : ""}</Link>)}</div>
            </section>
          ))}
          <section className={r.panel}>
            <p className={r.panelTitle}>Generated documents</p>
            {docs.length === 0 ? <p className={r.empty}>None yet.</p> : (
              <table className={ui.table}><tbody>{docs.map(d => (
                <tr key={d.id}><td><Link href={`/documents/generator/${d.id}`}><b>{d.title}</b></Link><span className={ui.sub} style={{ display: "block" }}>v{d.version} · {d.createdAt.slice(0, 10)} · {d.createdBy}</span></td>
                  <td>{d.legal ? <span className={ui.chip} style={{ color: d.legalReviewStatus === "approved" ? "var(--water)" : "#b0432f" }}>{d.legalReviewStatus === "approved" ? "Counsel approved" : "Counsel review required"}</span> : <span className={ui.chip}>Report</span>}</td></tr>
              ))}</tbody></table>
            )}
          </section>
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>{t ? t.name : "Choose a template"}</p>
            {!t ? <p className={r.empty}>Pick a template on the left.</p> : (
              <form action={generateAction} className={styles.stack}>
                <input type="hidden" name="templateKey" value={t.key} />
                {t.entity !== "none" && <label>{t.entity === "broker" ? "Introducer" : t.entity === "deal" ? "Opportunity" : t.entity}<select name="entityId" required={t.group === "Reports" || t.group === "Commercial"} defaultValue={chosen ?? ""}><option value="">{t.group === "Reports" || t.group === "Commercial" ? "Choose" : "None"}</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
                {preview && <div className={ui.sub}><b>{preview.title}</b><br />Draft for review: confidential, not sent anywhere; PDF or DOCX after creation.{missing.length ? <> Still to confirm ({missing.length}): {missing.slice(0, 12).join("; ")}{missing.length > 12 ? "…" : ""}. These stay visible as [TO CONFIRM] until filled.</> : " Nothing left to confirm."}</div>}
                {t.group === "Commercial" && <p className={ui.sub}>Built only from records: verified facts, labelled assumptions, prices only from the opportunity or the approved services catalogue, and proof only from disclosure-authorized case records.</p>}
                {t.fields.map(f => <label key={f.key}>{f.label}{f.area ? <textarea name={`f_${f.key}`} rows={3} /> : <input name={`f_${f.key}`} />}</label>)}
                {t.group === "Reports" && <p className={ui.sub}>Built from the records of the chosen {t.entity}, with report date, sources, unknowns and assumptions.</p>}
                <button className="btn btn--primary" type="submit">Generate</button>
              </form>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

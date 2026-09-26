import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import MarkdownLite from "@/components/markdown-lite";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { esignEnvelopes, generatedDocuments } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { withBase } from "@/lib/base-path";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { openPlaceholders, TEMPLATES } from "@/lib/documents/library";
import { approveLegalAction, newVersionAction, recordSignatureAction, signatureAction, signedUploadAction } from "../../../generator-actions";
import styles from "../../../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Generated document" };

export default async function GeneratedPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/documents/generator");
  const { id } = await params;
  const sp = await searchParams;
  const [d] = await appDb().select().from(generatedDocuments).where(and(eq(generatedDocuments.id, id), mandateCondition(user.scope, generatedDocuments.mandateId)));
  if (!d) notFound();
  const t = TEMPLATES.find(x => x.key === d.templateKey);
  const envs = await appDb().select().from(esignEnvelopes).where(eq(esignEnvelopes.generatedId, d.id)).orderBy(desc(esignEnvelopes.createdAt));
  const open = openPlaceholders(d.body);
  const signed = envs.some(e => e.status === "completed");
  const owner = isOwner(user.scope);

  return (
    <>
      <PageHeader title={d.title} actions={<><a className="btn btn--primary" href={withBase(`/api/documents/generated/${d.id}?format=pdf`)}>PDF</a><a className="btn" href={withBase(`/api/documents/generated/${d.id}?format=docx`)}>DOCX</a><Link className="btn" href="/documents/generator">Generator</Link></>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -6 }}>Version {d.version}{d.previousId ? <> · <Link href={`/documents/generator/${d.previousId}`}>previous version</Link></> : ""} · {d.createdAt.slice(0, 10)} by {d.createdBy} · {d.legal ? (d.legalReviewStatus === "approved" ? `counsel approved by ${d.reviewedBy} ${d.reviewedAt?.slice(0, 10)}` : "counsel review required") : "report"}{signed ? " · signed (read-only)" : ""}</p>
      {open.length > 0 && <p className={ui.notice}>Open items: {open.join(" · ")}</p>}
      <div className={r.grid}>
        <section className={r.panel}><MarkdownLite text={d.body} /></section>
        <aside>
          {d.legal && d.legalReviewStatus !== "approved" && owner && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Record counsel&apos;s approval</p>
              <form action={approveLegalAction} className={styles.stack}><input type="hidden" name="id" value={d.id} /><label>Reviewing counsel (name, firm)<input name="reviewer" required /></label><button className="btn" type="submit">Approve</button></form>
              <p className={ui.sub}>Only once counsel has reviewed this version. Refused while open items remain.</p>
            </section>
          )}
          {t && t.fields.length > 0 && !signed && (
            <section className={r.panel}>
              <p className={r.panelTitle}>New version</p>
              <form action={newVersionAction} className={styles.stack}>
                <input type="hidden" name="id" value={d.id} />
                {t.fields.map(f => <label key={f.key}>{f.label}{f.area ? <textarea name={`f_${f.key}`} rows={2} defaultValue={d.values[f.key] ?? ""} /> : <input name={`f_${f.key}`} defaultValue={d.values[f.key] ?? ""} />}</label>)}
                <button className="btn" type="submit">Save as new version</button>
              </form>
            </section>
          )}
          <section className={r.panel}>
            <p className={r.panelTitle}>Signature</p>
            {envs.map(e => (
              <div key={e.id} style={{ marginBottom: 8 }}>
                <p className={ui.sub}><b>{e.provider}</b> · {e.status}{e.signedDocumentUrl ? <> · <a href={e.signedDocumentUrl} target="_blank" rel="noreferrer">signed PDF</a></> : ""}</p>
                {e.recipients.map(x => <p key={x.email} className={ui.sub}>{x.name} ({x.role}) {x.email}: {x.signedAt ? `signed ${x.signedAt.slice(0, 10)}` : "pending"}
                  {!x.signedAt && e.provider === "mock" && e.status === "sent" && owner && <form action={recordSignatureAction} style={{ display: "inline", marginLeft: 6 }}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="envelopeId" value={e.id} /><input type="hidden" name="email" value={x.email} /><button className={ui.miniBtn} type="submit">Record signature</button></form>}</p>)}
              </div>
            ))}
            {!signed && owner && (
              <form action={signatureAction} className={styles.stack}>
                <input type="hidden" name="id" value={d.id} />
                <label>Signers (one per line: name, email, role)<textarea name="signers" rows={3} placeholder={"Ana Ruiz, ana@example.com, Introducer\nAlan Prado, alanprado@regenera.bio, Regenera"} /></label>
                <label>Provider<select name="provider" defaultValue="mock"><option value="mock">Mock (development: nothing is sent)</option><option value="docusign">DocuSign (credential required)</option><option value="dropbox_sign">Dropbox Sign (credential required)</option></select></label>
                <button className="btn" type="submit">Send for signature</button>
              </form>
            )}
            {!signed && <form action={signedUploadAction} className={styles.stack} style={{ marginTop: 8 }}><input type="hidden" name="id" value={d.id} /><label>Or record the signed PDF (https link)<input name="url" type="url" required /></label><button className={ui.miniBtn} type="submit">Record signed PDF</button></form>}
          </section>
        </aside>
      </div>
    </>
  );
}

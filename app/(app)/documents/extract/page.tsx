import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { docExtractions, mandates, organizations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { findSponsorOrg } from "@/lib/documents/extract";
import { applyExtractionAction, extractDocumentAction } from "../../casework-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Read a sponsor document" };

const money = (n: number | null) => (n === null ? "—" : `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}m`);

export default async function ExtractPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/documents/extract");
  const sp = await searchParams;
  const db = appDb();
  const ws = user.scope.mandateIds.length ? await db.select({ id: mandates.id, name: mandates.name }).from(mandates).where(inArray(mandates.id, user.scope.mandateIds)) : [];
  const recent = await db.select({ id: docExtractions.id, fileName: docExtractions.fileName, status: docExtractions.status, createdAt: docExtractions.createdAt, error: docExtractions.error }).from(docExtractions).where(mandateCondition(user.scope, docExtractions.mandateId)).orderBy(desc(docExtractions.createdAt)).limit(15);
  const [ex] = sp.id ? await db.select().from(docExtractions).where(and(eq(docExtractions.id, sp.id), mandateCondition(user.scope, docExtractions.mandateId))) : [];
  const sponsor = ex?.result?.sponsor ? await findSponsorOrg(db, ex.mandateId, ex.result.sponsor.name) : null;
  const orgs = ex ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.mandateId, ex.mandateId)).orderBy(organizations.name).limit(800) : [];
  return <>
    <PageHeader title="Read a sponsor document" />
    <Notice text={sp.notice} />
    <p className={ui.notice}>Upload a group report, project sheets or an information memorandum. Claude reads the PDF and proposes the sponsor, each project and its stated figures with page numbers. Nothing is written until you choose what to apply; applied figures become claims marked &quot;source provided&quot;, never verified facts. The PDF is kept in Documents as confidential.</p>
    <div className={r.grid}>
      <section className={r.panel}>
        {!ex ? <p className={r.empty}>Upload a PDF, or open an earlier reading on the right.</p> : <>
          <p className={r.panelTitle}>{ex.fileName} · {ex.status === "applied" ? `applied by ${ex.appliedBy}` : ex.status === "failed" ? "failed" : "ready to review"}</p>
          {ex.error && <p className={ui.sub}>{ex.error}</p>}
          {ex.result && <form action={applyExtractionAction}>
            <input type="hidden" name="id" value={ex.id} />
            {ex.result.sponsor && <p>Sponsor stated: <b>{ex.result.sponsor.name}</b>{ex.result.sponsor.country ? ` (${ex.result.sponsor.country})` : ""}. {sponsor ? <>Found in Network: <Link href={`/companies/${sponsor.id}`}>{sponsor.name}</Link>.</> : "Not in Network yet."}</p>}
            <label className={ui.sub}>Link projects to sponsor <select name="sponsorOrgId" defaultValue={sponsor?.id ?? ""}><option value="">None</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            <table className={ui.table}><thead><tr><th></th><th>Project</th><th>Country · locality</th><th>MW</th><th>GWh/yr</th><th>CAPEX</th><th>Tariff · storage</th><th>Financing · offtake</th><th>Page</th></tr></thead><tbody>
              {ex.result.projects.map((p, i) => <tr key={i}><td><input type="checkbox" name="project" value={i} defaultChecked={ex.status !== "applied"} aria-label={`Apply ${p.name}`} /></td>
                <td><b>{p.name}</b>{p.status ? <div className={ui.sub}>{p.status}</div> : null}</td><td>{p.country ?? "—"} · {p.locality ?? "—"}</td><td className={ui.num}>{p.capacityMw ?? "—"}</td><td className={ui.num}>{p.annualGwh ?? "—"}</td>
                <td className={ui.num}>{money(p.capexUsd)}</td><td className={ui.sub}>{p.tariff ?? "—"} · {p.storage ?? "—"}</td><td className={ui.sub}>{p.financing ?? "—"} · {p.offtake ?? "—"}</td><td className={ui.num}>{p.page ?? "—"}</td></tr>)}
            </tbody></table>
            <p className={ui.sub}>Existing projects with the same name are matched (figures are added as claims, nothing overwritten); others are created at stage Opportunity.</p>
            <button className="btn btn--primary" type="submit">Apply selected</button>
          </form>}
          {ex.result?.statements.length ? <><p className={r.panelTitle} style={{ marginTop: 24 }}>Sponsor statements to test</p>
            <ul>{ex.result.statements.map((s, i) => <li key={i}>{s.statement}{s.page ? <span className={ui.sub}> (p. {s.page})</span> : null}</li>)}</ul>
            <p className={ui.sub}>Copied as stated. Check each against filed accounts, registries and the data room before relying on it.</p></> : null}
        </>}
      </section>
      <aside>
        <section className={r.panel}><p className={r.panelTitle}>Upload a PDF</p>
          <form action={extractDocumentAction} className={r.form}>
            <label>Workspace<select name="mandateId">{ws.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            <label>PDF (up to 30 MB, 100 pages)<input type="file" name="file" accept="application/pdf" required /></label>
            <button className="btn" type="submit">Read document</button>
            <p className={ui.sub}>Uses the AI budget (logged per call). Takes up to a minute for a long report.</p>
          </form></section>
        <section className={r.panel}><p className={r.panelTitle}>Earlier readings</p>
          {recent.length === 0 ? <p className={r.empty}>None yet.</p> : <ul>{recent.map(x => <li key={x.id}><Link href={`/documents/extract?id=${x.id}`}>{x.fileName}</Link> <span className={ui.sub}>{x.status} · {x.createdAt.slice(0, 10)}</span></li>)}</ul>}
        </section>
      </aside>
    </div>
  </>;
}

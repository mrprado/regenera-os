import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { day } from "@/lib/mandates/format";
import { approvalsFor } from "@/lib/mandates/queries";
import { APPROVAL_KINDS, APPROVAL_STATUSES } from "@/lib/mandates/vocab";
import { decideApprovalAction } from "../origination-actions";
import f from "../funding/funding.module.css";
import s from "../mandates/mandates.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

const link = (t: string, id: string) => (t === "pursuits" ? `/pursuits/${id}` : t === "mandate_candidates" ? `/mandates/candidates/${id}` : t === "commercial_mandates" ? `/mandates/${id}` : null);

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/approvals");
  const sp = await searchParams;
  const status = sp.status ?? "pending";
  const rows = await approvalsFor(appDb(), user.scope, status);
  return (
    <>
      <PageHeader title="Approvals" count={rows.length} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Material actions wait here for a named person: outreach, introductions, data sharing, NDAs, bids, investor access, diligence material, term sheets, offers, capital structures, community engagement and final submissions. Each decision records who, when, the rationale, conditions and the document version. AI is never the approver. Message drafts keep their own queue under Relationships → Approval queue.</p>
      <nav className={f.inline} style={{ marginBottom: 10 }}>{["pending", "approved", "approved_conditions", "rejected", "all"].map(x => <Link key={x} href={`/approvals?status=${x}`} className={s.reading} data-r={x === status ? "strong" : undefined}>{x === "all" ? "All" : APPROVAL_STATUSES[x as keyof typeof APPROVAL_STATUSES]}</Link>)}</nav>
      {rows.length === 0 ? <EmptyState icon={ShieldCheck} title="Nothing here" body="Approval requests appear when a pursuit, candidate or mandate needs a decision." /> : rows.map(a => (
        <section key={a.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
          <div className={f.inline}><strong>{link(a.entityType, a.entityId) ? <Link href={link(a.entityType, a.entityId)!}>{a.title}</Link> : a.title}</strong><span className={s.reading}>{APPROVAL_KINDS[a.kind as keyof typeof APPROVAL_KINDS] ?? a.kind}</span><span className={s.reading} data-r={a.status}>{APPROVAL_STATUSES[a.status as keyof typeof APPROVAL_STATUSES]}</span></div>
          <p className={ui.sub}>Requested by {a.requester} · {day(a.createdAt)} · approver {a.approver ?? "any workspace owner"}{a.documentVersion ? ` · document v${a.documentVersion}` : ""}</p>
          {a.detail && <p style={{ fontSize: 13, margin: "4px 0" }}>{a.detail}</p>}
          {a.status === "pending" ? (
            <form action={decideApprovalAction} className={f.grid3} style={{ maxWidth: 900 }}>
              <input type="hidden" name="id" value={a.id} />
              <label>Decision<select name="status" defaultValue="approved"><option value="approved">Approve</option><option value="approved_conditions">Approve with conditions</option><option value="rejected">Reject</option><option value="withdrawn">Withdraw (requester)</option></select></label>
              <label>Rationale<input name="rationale" /></label>
              <label>Conditions<input name="conditions" /></label>
              <div className={f.full}><button className="btn btn-primary" type="submit">Record decision</button></div>
            </form>
          ) : <p className={ui.sub}>{a.decidedBy} · {day(a.decidedAt)}: {a.rationale}{a.conditions ? ` · conditions: ${a.conditions}` : ""}</p>}
        </section>
      ))}
    </>
  );
}

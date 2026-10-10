import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { communities, communityAuthorities, knowledgePermissions, knowledgeRecords, knowledgeUses } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { publicView } from "@/lib/community/engine";
import { ACCESS_STATUS, ACTIVITIES, AI_ACTIVITIES, KNOWLEDGE_CATEGORIES, PERMISSION_STATUS } from "@/lib/community/vocab";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { canSeeKnowledge } from "@/lib/steward/engine";
import { KNOWLEDGE_KINDS, KNOWLEDGE_TRADITIONS } from "@/lib/steward/vocab";
import { setKnowledgePermissionAction, withdrawKnowledgeStewardAction } from "../../actions";
import s from "../../steward.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Knowledge record" };

/** A governed knowledge record: who holds it, what may be done with it, and where it has been used. */
export default async function KnowledgePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/steward/knowledge/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [r] = await db.select().from(knowledgeRecords).where(and(eq(knowledgeRecords.id, id), mandateCondition(user.scope, knowledgeRecords.mandateId), isNull(knowledgeRecords.deletedAt)));
  // Records the user may not know exist are reported as not found, so the URL itself reveals nothing.
  if (!r || !canSeeKnowledge(user.scope, r)) notFound();
  const owner = isOwner(user.scope, r.mandateId);
  const view = publicView(r);
  const [perms, uses, [community], authorities] = await Promise.all([
    db.select().from(knowledgePermissions).where(and(eq(knowledgePermissions.recordId, id), isNull(knowledgePermissions.deletedAt))),
    owner ? db.select().from(knowledgeUses).where(eq(knowledgeUses.recordId, id)).orderBy(desc(knowledgeUses.usedAt)) : Promise.resolve([]),
    r.communityId ? db.select().from(communities).where(eq(communities.id, r.communityId)) : Promise.resolve([]),
    r.communityId ? db.select().from(communityAuthorities).where(and(eq(communityAuthorities.communityId, r.communityId), isNull(communityAuthorities.deletedAt))) : Promise.resolve([]),
  ]);
  const status = (a: string) => perms.find(p => p.activity === a)?.status ?? "none";
  return (
    <>
      <PageHeader title={view.title} actions={<Link className="btn" href="/steward?tab=knowledge">All knowledge</Link>} />
      <Notice text={sp.notice} />
      <div className={s.grid}>
        <div><b>Kind</b><p>{KNOWLEDGE_KINDS[r.recordKind as keyof typeof KNOWLEDGE_KINDS] ?? r.recordKind}</p></div>
        <div><b>Tradition</b><p>{KNOWLEDGE_TRADITIONS[r.tradition as keyof typeof KNOWLEDGE_TRADITIONS] ?? r.tradition}</p></div>
        <div><b>Category</b><p>{KNOWLEDGE_CATEGORIES[r.category as keyof typeof KNOWLEDGE_CATEGORIES]}</p></div>
        <div><b>Access</b><p>{ACCESS_STATUS[r.accessStatus as keyof typeof ACCESS_STATUS]}{r.withdrawn ? " · withdrawn" : ""}</p></div>
        <div><b>Custodian community</b><p>{community ? community.preferredName || community.name : "None recorded"}</p></div>
        <div><b>Review</b><p>{r.reviewDate ?? "No review date"}</p></div>
      </div>
      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>What may be shown</h2>
        <p className={s.empty}>{view.description || "Nothing beyond the record's existence."}</p>
        {!view.restricted && r.permittedPurpose && <p className={s.note}>Permitted purpose: {r.permittedPurpose}</p>}
        {owner && <div className={s.grid}>
          <div><b>Contributor</b><p>{r.contributor || "Not recorded"}</p></div>
          <div><b>Evidence of authority</b><p>{r.authorityEvidence || "Not recorded"}</p></div>
          <div><b>Permitted users</b><p>{(r.permittedUsers ?? []).join(", ") || "Not limited by name"}</p></div>
          <div><b>Compensation · benefit sharing</b><p>{r.compensation || "—"} · {r.benefitSharing || "—"}</p></div>
          <div><b>Language · translation</b><p>{r.originalLanguage || "—"} · {r.translationProvenance || "no translation"}</p></div>
        </div>}
      </section>
      <section className={s.card} style={{ marginTop: 16 }}>
        <h2>Permissions by activity<span>default: not allowed</span></h2>
        <p className={s.empty}>Anything without a recorded permission is not allowed. AI retrieval, summarisation and model training are separate permissions; model training defaults to no. Permissions come from a verified community authority with the matching power.</p>
        <div className={s.grid}>{[...AI_ACTIVITIES, "public_publication", "commercial_advisory", "digitization", "translation", "exact_coordinate_disclosure", "generalized_mapping", "investor_diligence"].map(a => (
          <div key={a}><b>{ACTIVITIES[a as keyof typeof ACTIVITIES]}</b><p><span className={s.state} data-s={status(a) === "allowed" ? "done" : status(a) === "none" ? "not_assessed" : status(a)}>{status(a) === "none" ? "Not allowed (no permission)" : PERMISSION_STATUS[status(a) as keyof typeof PERMISSION_STATUS]}</span></p></div>
        ))}</div>
        {owner && !r.withdrawn && r.accessStatus !== "existence_only" && (authorities.length ? (
          <form action={setKnowledgePermissionAction} className={s.form}><input type="hidden" name="recordId" value={id} />
            <label>Activity<select name="activity">{Object.entries(ACTIVITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Decision<select name="status" defaultValue="pending"><option value="allowed">Allowed</option><option value="allowed_with_conditions">Allowed with conditions</option><option value="prohibited">Prohibited</option><option value="pending">Pending</option></select></label>
            <label>Authority<select name="authorityId">{authorities.map(a => <option key={a.id} value={a.id}>{a.name}{a.verificationStatus === "verified" ? "" : " (unverified)"}</option>)}</select></label>
            <label>Expires<input name="expiryDate" type="date" /></label>
            <label className={s.wide}>Conditions<input name="conditions" /></label>
            <label className={s.wide}>Evidence of the decision<input name="evidence" required /></label>
            <div><button className="btn" type="submit">Record permission</button></div>
          </form>
        ) : <p className={s.note}>Record the community&apos;s authority (with its powers) on the project&apos;s Community tab before any permission can be recorded.</p>)}
      </section>
      {owner && (
        <section className={s.card} style={{ marginTop: 16 }}>
          <h2>Where it has been used<span>{uses.length}</span></h2>
          {uses.length ? <ul>{uses.map(u => <li key={u.id}>{u.outputType}: {u.outputRef}<span>{ACTIVITIES[u.activity as keyof typeof ACTIVITIES]} · {u.status}{u.flaggedReason ? ` · ${u.flaggedReason}` : ""} · {u.usedAt.slice(0, 10)}</span></li>)}</ul> : <p className={s.empty}>No recorded use.</p>}
          {!r.withdrawn && <form action={withdrawKnowledgeStewardAction} className={s.form}><input type="hidden" name="recordId" value={id} />
            <label className={s.wide}>Withdraw all permissions (reason)<input name="reason" required /></label>
            <div><button className="btn" type="submit">Withdraw</button></div></form>}
          <p className={ui.sub}>Withdrawal stops future use, flags every recorded use for remediation and creates tasks; copies already shared outside the OS cannot be recalled automatically.</p>
        </section>
      )}
    </>
  );
}

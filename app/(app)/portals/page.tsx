import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import {
  brokerProfiles, capitalOpportunities, commissionEvents, commissionSchedules, dataRoomDocuments, dataRooms, distributionApprovals, documentRequests, documents,
  intakeSubmissions, organizations, portalAccessLog, portalGrants, portalMessages, portalUsers, procurementPackages, projects, projectUpdates, referralAgreements,
  referralRegistrations,
} from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { compactMoney } from "@/lib/projects/labels";
import {
  AGREEMENT_STATUSES, BROKER_ROLES, BROKER_STATUSES, COMMISSION_STATUSES, COMMISSION_TYPES, DATA_ROOM_FOLDERS, GRANT_ENTITIES, INTAKE_KINDS, INTAKE_STATUSES, INVITE_FLASH,
  PORTAL_KINDS, PORTAL_USER_STATUSES, REFERRAL_STATUSES, REFERRAL_TARGETS, REQUEST_STATUSES,
} from "@/lib/portal/vocab";
import {
  addAgreementAction, agreementStatusAction, commissionStatusAction, createDataRoomAction, createRequestAction, createUpdateAction, dataRoomAction, distributionAction, grantAction,
  intakeAction, invitePortalUserAction, portalUserStatusAction, publishUpdateAction, recordCommissionAction, replyPortalAction, reviewBrokerAction, reviewReferralAction, reviewRequestAction, revokeGrantAction,
} from "../portal-admin-actions";
import styles from "../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portals" };

const TABS = [["users", "Users"], ["access", "Access"], ["referrals", "Referrals"], ["brokers", "Introducers and fees"], ["rooms", "Data rooms"], ["distribution", "Distribution"], ["requests", "Requests and updates"], ["intake", "Intake"], ["messages", "Messages"]] as const;

export default async function PortalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/portals");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "users";
  const db = appDb();
  const owner = isOwner(user.scope);
  const flash = (await cookies()).get(INVITE_FLASH)?.value;
  const [users, orgs] = await Promise.all([
    db.select({ u: portalUsers, org: organizations.name }).from(portalUsers).leftJoin(organizations, eq(organizations.id, portalUsers.orgId)).where(mandateCondition(user.scope, portalUsers.mandateId)).orderBy(asc(portalUsers.kind), asc(portalUsers.email)),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(mandateCondition(user.scope, organizations.mandateId), isNull(organizations.archivedAt))).orderBy(asc(organizations.name)).limit(1000),
  ]);
  const nameOf = new Map(users.map(x => [x.u.id, x.u.name || x.u.email]));
  const [projectRows, docRows] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt))).orderBy(asc(projects.name)),
    db.select({ id: documents.id, title: documents.title, version: documents.version }).from(documents).where(mandateCondition(user.scope, documents.mandateId)).orderBy(desc(documents.updatedAt)).limit(500),
  ]);
  const flashParts = flash?.split("|");

  return (
    <>
      <PageHeader title="Portals" actions={<Link className="btn" href="/documents">Documents</Link>} />
      <Notice text={sp.notice} />
      {flashParts && flashParts[1] && <p className={ui.notice}>Invitation link for {flashParts[0]} (shown once): <code style={{ userSelect: "all" }}>{`${env.APP_BASE_URL ?? "https://regenera.bio/os"}${flashParts[1]}`}</code></p>}
      <p className={ui.sub} style={{ marginTop: -4 }}>External users see only what a grant names, and only through the gates: broker standing, capital compliance gate, NDA, distribution approval. Public intake: <a href="../intake/project">/intake/project</a> · <a href="../intake/capital">capital</a> · <a href="../intake/broker">broker</a> · <a href="../intake/partner">partner</a>. Portal sign-in: <a href="../portal/signin">/portal/signin</a>.</p>
      <nav className={ui.tabs} aria-label="Portal sections">{TABS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/portals?tab=${k}`}>{l}</Link>)}</nav>

      {tab === "users" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Portal users</p>
            {users.length === 0 ? <p className={r.empty}>No external users yet. Invite a sponsor, capital partner, introducer or partner; they set their own password from the link.</p> : (
              <table className={ui.table}><tbody>{users.map(({ u, org }) => (
                <tr key={u.id}>
                  <td><b>{u.name || u.email}</b>{u.isDemo ? <span className={ui.chip} style={{ marginLeft: 6 }}>DEMO</span> : null}<span className={ui.sub} style={{ display: "block" }}>{u.email} · {PORTAL_KINDS[u.kind]}{org ? ` · ${org}` : ""} · {PORTAL_USER_STATUSES[u.status]}{u.lastLoginAt ? ` · last sign-in ${u.lastLoginAt.slice(0, 10)}` : ""}</span></td>
                  <td>
                    <form action={portalUserStatusAction} className={styles.inline}>
                      <input type="hidden" name="portalUserId" value={u.id} />
                      <select name="status" defaultValue={u.status === "invited" ? "active" : u.status} aria-label="Status"><option value="active">Active</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select>
                      <button className={ui.miniBtn} type="submit">Set</button>
                    </form>
                  </td>
                </tr>
              ))}</tbody></table>
            )}
          </section>
          <aside>
            <section className={r.panel}>
              <p className={r.panelTitle}>Invite</p>
              <form action={invitePortalUserAction} className={styles.stack}>
                <label>Email<input name="email" type="email" required /></label>
                <label>Name<input name="name" /></label>
                <label>Portal<select name="kind" required>{Object.entries(PORTAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>Organization<select name="orgId" defaultValue=""><option value="">None</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                <button className="btn btn--primary" type="submit">Create invitation link</button>
              </form>
              <p className={ui.sub}>Nothing is emailed. Send the link yourself. Re-inviting creates a fresh link.</p>
            </section>
          </aside>
        </div>
      )}

      {tab === "access" && <AccessTab scope={user.scope} users={users.map(x => x.u)} projectRows={projectRows} docRows={docRows} nameOf={nameOf} />}
      {tab === "referrals" && <ReferralsTab scope={user.scope} owner={owner} />}
      {tab === "brokers" && <BrokersTab scope={user.scope} owner={owner} nameOf={nameOf} />}
      {tab === "rooms" && <RoomsTab scope={user.scope} projectRows={projectRows} docRows={docRows} nameOf={nameOf} />}
      {tab === "distribution" && <DistributionTab scope={user.scope} owner={owner} docRows={docRows} />}
      {tab === "requests" && <RequestsTab scope={user.scope} users={users.map(x => x.u)} projectRows={projectRows} nameOf={nameOf} />}
      {tab === "intake" && <IntakeTab />}
      {tab === "messages" && <MessagesTab scope={user.scope} nameOf={nameOf} />}
    </>
  );
}

type Scope = Parameters<typeof mandateCondition>[0];
type PU = typeof portalUsers.$inferSelect;

async function AccessTab({ scope, users, projectRows, docRows, nameOf }: { scope: Scope; users: PU[]; projectRows: { id: string; name: string }[]; docRows: { id: string; title: string }[]; nameOf: Map<string, string> }) {
  const db = appDb();
  const [grants, opps, rooms, pkgs, log] = await Promise.all([
    db.select().from(portalGrants).where(and(mandateCondition(scope, portalGrants.mandateId), isNull(portalGrants.revokedAt))).orderBy(desc(portalGrants.createdAt)).limit(300),
    db.select({ id: capitalOpportunities.id, title: capitalOpportunities.title, gate: capitalOpportunities.gateState }).from(capitalOpportunities).where(mandateCondition(scope, capitalOpportunities.mandateId)),
    db.select({ id: dataRooms.id, name: dataRooms.name }).from(dataRooms).where(mandateCondition(scope, dataRooms.mandateId)),
    db.select({ id: procurementPackages.id, name: procurementPackages.name }).from(procurementPackages).where(mandateCondition(scope, procurementPackages.mandateId)),
    users.length ? db.select().from(portalAccessLog).where(inArray(portalAccessLog.portalUserId, users.map(u => u.id))).orderBy(desc(portalAccessLog.at)).limit(40) : [],
  ]);
  const label = (type: string, id: string) => (type === "project" ? projectRows.find(x => x.id === id)?.name : type === "document" ? docRows.find(x => x.id === id)?.title : type === "capital_opportunity" ? opps.find(x => x.id === id)?.title : type === "data_room" ? rooms.find(x => x.id === id)?.name : type === "procurement_package" ? pkgs.find(x => x.id === id)?.name : id) ?? id;
  const options: Record<string, { id: string; name: string }[]> = {
    project: projectRows, document: docRows.map(d => ({ id: d.id, name: d.title })), capital_opportunity: opps.map(o => ({ id: o.id, name: `${o.title} (gate ${o.gate.replace(/_/g, " ")})` })),
    data_room: rooms, procurement_package: pkgs, deal: [],
  };
  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>Active grants</p>
          {grants.length === 0 ? <p className={r.empty}>No grants. External users see nothing until you grant a specific project, opportunity, data room, document or package.</p> : (
            <table className={ui.table}><tbody>{grants.map(g => (
              <tr key={g.id}><td><b>{nameOf.get(g.portalUserId)}</b> → {GRANT_ENTITIES[g.entityType]}: {label(g.entityType, g.entityId)}<span className={ui.sub} style={{ display: "block" }}>{[g.canDownload && "download", g.expiresAt && `until ${g.expiresAt.slice(0, 10)}`, `by ${g.grantedBy}`, g.note].filter(Boolean).join(" · ")}</span></td>
                <td><form action={revokeGrantAction}><input type="hidden" name="grantId" value={g.id} /><button className={ui.miniBtn} type="submit">Revoke</button></form></td></tr>
            ))}</tbody></table>
          )}
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Recent portal access</p>
          {log.length === 0 ? <p className={r.empty}>No access yet.</p> : (
            <table className={ui.table}><tbody>{log.map(l => <tr key={l.id}><td>{l.at.slice(0, 16).replace("T", " ")}</td><td>{nameOf.get(l.portalUserId)}</td><td>{l.action}{l.entityType ? ` · ${l.entityType}` : ""}</td><td style={{ color: l.allowed ? undefined : "#b0432f" }}>{l.allowed ? "allowed" : "denied"}{l.reason ? `: ${l.reason}` : ""}</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Grant access</p>
          <form action={grantAction} className={styles.stack}>
            <label>User<select name="portalUserId" required defaultValue=""><option value="" disabled>Choose</option>{users.filter(u => u.status !== "revoked").map(u => <option key={u.id} value={u.id}>{u.name || u.email} ({u.kind})</option>)}</select></label>
            <label>What<select name="entityType" required>{Object.entries(GRANT_ENTITIES).filter(([k]) => k !== "deal").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {Object.entries(options).filter(([k]) => k !== "deal").map(([k, list]) => <label key={k}>{GRANT_ENTITIES[k as keyof typeof GRANT_ENTITIES]}<select name={`entity_${k}`} defaultValue=""><option value="">—</option>{list.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>)}
            <label>Expires<input name="expiresAt" type="date" /></label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="canDownload" /> May download</label>
            <label>Note<input name="note" /></label>
            <button className="btn btn--primary" type="submit">Grant</button>
          </form>
          <p className={ui.sub}>Pick the item in the list matching &quot;What&quot;.</p>
        </section>
      </aside>
    </div>
  );
}

async function ReferralsTab({ scope, owner }: { scope: Scope; owner: boolean }) {
  const rows = await appDb().select({ r: referralRegistrations, broker: portalUsers.name, email: portalUsers.email }).from(referralRegistrations)
    .innerJoin(brokerProfiles, eq(brokerProfiles.id, referralRegistrations.brokerId)).innerJoin(portalUsers, eq(portalUsers.id, brokerProfiles.portalUserId))
    .where(mandateCondition(scope, referralRegistrations.mandateId)).orderBy(asc(referralRegistrations.status), desc(referralRegistrations.createdAt)).limit(300);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Referral registrations</p>
      {rows.length === 0 ? <p className={r.empty}>No registrations.</p> : (
        <table className={ui.table}><tbody>{rows.map(({ r: x, broker, email }) => (
          <tr key={x.id}>
            <td><b>{x.name}</b>{x.organization ? ` · ${x.organization}` : ""} <span className={ui.chip}>{REFERRAL_TARGETS[x.targetType]}</span> <span className={ui.chip}>{REFERRAL_STATUSES[x.status]}</span>
              <span className={ui.sub} style={{ display: "block" }}>by {broker || email} · {x.createdAt.slice(0, 10)}{x.jurisdiction ? ` · ${x.jurisdiction}` : ""}{x.contactEmail ? ` · ${x.contactEmail}` : ""}{x.expiresAt ? ` · protected to ${x.expiresAt}` : ""}</span>
              {x.relationship && <span className={ui.sub} style={{ display: "block" }}>Relationship: {x.relationship}</span>}
              {x.intendedIntroduction && <span className={ui.sub} style={{ display: "block" }}>Intended: {x.intendedIntroduction}</span>}
              {x.conflicts.map((c, i) => <span key={i} className={styles.flag} style={{ display: "block", fontSize: 12.5 }}>{c.kind.replace(/_/g, " ")}: {c.detail}</span>)}
              {x.matchedOrgId && <Link href={`/companies/${x.matchedOrgId}`} className={ui.sub}>Existing organization</Link>}</td>
            <td>{owner && ["submitted", "conflict_review", "approved"].includes(x.status) ? (
              <form action={reviewReferralAction} className={styles.stack} style={{ minWidth: 200 }}>
                <input type="hidden" name="registrationId" value={x.id} />
                <select name="decision" defaultValue={x.conflicts.some(c => c.kind === "existing_record") ? "already_known" : "approved"} aria-label="Decision"><option value="approved">Approve</option><option value="already_known">Already known</option><option value="rejected">Reject</option><option value="converted">Converted</option></select>
                <input name="note" placeholder="Note to the introducer" aria-label="Note" />
                <button className={ui.miniBtn} type="submit">Decide</button>
              </form>
            ) : null}</td>
          </tr>
        ))}</tbody></table>
      )}
      {!owner && <p className={ui.sub}>Decisions are owner-only.</p>}
    </section>
  );
}

async function BrokersTab({ scope, owner, nameOf }: { scope: Scope; owner: boolean; nameOf: Map<string, string> }) {
  const db = appDb();
  const [brokers, agreements, events, regs] = await Promise.all([
    db.select().from(brokerProfiles).where(mandateCondition(scope, brokerProfiles.mandateId)),
    db.select({ a: referralAgreements, s: commissionSchedules }).from(referralAgreements).leftJoin(commissionSchedules, eq(commissionSchedules.agreementId, referralAgreements.id)).where(mandateCondition(scope, referralAgreements.mandateId)),
    db.select().from(commissionEvents).where(mandateCondition(scope, commissionEvents.mandateId)).orderBy(desc(commissionEvents.createdAt)).limit(200),
    db.select({ id: referralRegistrations.id, brokerId: referralRegistrations.brokerId, name: referralRegistrations.name, status: referralRegistrations.status }).from(referralRegistrations).where(mandateCondition(scope, referralRegistrations.mandateId)),
  ]);
  return (
    <>
      {brokers.length === 0 && <section className={r.panel}><p className={r.empty}>No introducers. Invite one from Users (portal: Broker / introducer) or convert a broker intake.</p></section>}
      {brokers.map(b => {
        const ags = agreements.filter(x => x.a.brokerId === b.id);
        return (
          <section key={b.id} className={r.panel}>
            <p className={r.panelTitle}><span>{nameOf.get(b.portalUserId)} · {BROKER_ROLES[b.roleType]}</span><span className={ui.chip}>{BROKER_STATUSES[b.complianceStatus]}</span></p>
            <p className={ui.sub}>{[`Agreement: ${AGREEMENT_STATUSES[b.agreementStatus]}${b.agreementExpiresAt ? ` to ${b.agreementExpiresAt}` : ""}`, `licence ${b.licenseStatus}${b.registrationNumbers ? ` (${b.registrationNumbers})` : ""}`, b.jurisdictions.length && `jurisdictions ${b.jurisdictions.join(", ")}`, b.reviewedBy && `reviewed by ${b.reviewedBy} ${b.reviewedAt?.slice(0, 10)}`].filter(Boolean).join(" · ")}</p>
            {b.reviewNote && <p className={ui.sub} style={{ whiteSpace: "pre-wrap" }}>{b.reviewNote}</p>}
            {owner && (
              <details><summary className={ui.sub}>Review</summary>
                <form action={reviewBrokerAction} className={styles.grid2} style={{ marginTop: 6 }}>
                  <input type="hidden" name="brokerId" value={b.id} />
                  <label>Role<select name="roleType" defaultValue={b.roleType}>{Object.entries(BROKER_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Compliance status<select name="complianceStatus" defaultValue={b.complianceStatus}>{Object.entries(BROKER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Agreement<select name="agreementStatus" defaultValue={b.agreementStatus}>{Object.entries(AGREEMENT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Agreement expires<input name="agreementExpiresAt" type="date" defaultValue={b.agreementExpiresAt ?? ""} /></label>
                  <label>Licence<select name="licenseStatus" defaultValue={b.licenseStatus}><option value="none">None</option><option value="claimed">Claimed</option><option value="verified">Verified</option><option value="expired">Expired</option></select></label>
                  <label>Jurisdictions<input name="jurisdictions" defaultValue={b.jurisdictions.join(", ")} /></label>
                  <label>Registration numbers<input name="registrationNumbers" defaultValue={b.registrationNumbers} /></label>
                  <label>Licence evidence<input name="licenseEvidence" defaultValue={b.licenseEvidence} placeholder="Register lookup, date" /></label>
                  <label className={styles.wide}>Review note<input name="reviewNote" /></label>
                  <button className={ui.miniBtn} type="submit">Save review</button>
                </form>
              </details>
            )}
            <p className={ui.sub}><b>Agreements and schedules</b></p>
            {ags.length === 0 ? <p className={r.empty}>No agreement recorded.</p> : (
              <table className={ui.table}><tbody>{ags.map(({ a, s }) => (
                <tr key={a.id + (s?.id ?? "")}>
                  <td>{a.title} · {a.status} · legal review {a.legalReviewStatus}{a.expiresAt ? ` · to ${a.expiresAt}` : ""}
                    {s && <span className={ui.sub} style={{ display: "block" }}>{COMMISSION_TYPES[s.type]}{s.rate !== null ? ` ${s.rate}${s.type === "bps" ? " bps" : "%"}` : ""}{s.amount !== null ? ` ${compactMoney(s.amount, s.currency)}` : ""}{s.cap !== null ? ` · cap ${compactMoney(s.cap, s.currency)}` : ""}{s.minimum !== null ? ` · min ${compactMoney(s.minimum, s.currency)}` : ""} · schedule {s.approvalStatus}{s.paymentTrigger ? ` · paid on ${s.paymentTrigger}` : ""}</span>}</td>
                  <td>{owner && (
                    <form action={agreementStatusAction} className={styles.stack}>
                      <input type="hidden" name="agreementId" value={a.id} />
                      <select name="status" defaultValue={a.status} aria-label="Agreement status"><option value="draft">Draft</option><option value="active">Active</option><option value="expired">Expired</option><option value="terminated">Terminated</option></select>
                      <select name="legalReviewStatus" defaultValue={a.legalReviewStatus} aria-label="Legal review"><option value="pending">Legal review pending</option><option value="approved">Legal review approved</option></select>
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}><input type="checkbox" name="approveSchedule" /> Approve schedule</label>
                      <button className={ui.miniBtn} type="submit">Save</button>
                    </form>
                  )}</td>
                </tr>
              ))}</tbody></table>
            )}
            {owner && (
              <details><summary className={ui.sub}>Record an agreement and schedule</summary>
                <form action={addAgreementAction} className={styles.grid2} style={{ marginTop: 6 }}>
                  <input type="hidden" name="brokerId" value={b.id} />
                  <label>Title<input name="title" placeholder="Referral agreement 2026" /></label>
                  <label>Type<select name="type">{Object.entries(COMMISSION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Rate (% or bps)<input name="rate" inputMode="decimal" /></label>
                  <label>Amount (fixed / milestone)<input name="amount" inputMode="decimal" /></label>
                  <label>Currency<input name="currency" defaultValue="USD" /></label>
                  <label>Cap<input name="cap" inputMode="decimal" /></label>
                  <label>Minimum<input name="minimum" inputMode="decimal" /></label>
                  <label>Effective<input name="effectiveDate" type="date" /></label>
                  <label>Expires<input name="expiresAt" type="date" /></label>
                  <label>Calculation basis<input name="calculationBasis" placeholder="e.g. capital committed by introduced investor" /></label>
                  <label>Eligibility conditions<input name="eligibilityConditions" /></label>
                  <label>Payment trigger<input name="paymentTrigger" placeholder="e.g. financial close" /></label>
                  <button className={ui.miniBtn} type="submit">Record</button>
                </form>
              </details>
            )}
            <p className={ui.sub}><b>Commissions</b></p>
            {events.filter(e => e.brokerId === b.id).length === 0 ? <p className={r.empty}>None.</p> : (
              <table className={ui.table}><tbody>{events.filter(e => e.brokerId === b.id).map(e => (
                <tr key={e.id}><td>{compactMoney(e.amount, e.currency)}{e.basisAmount !== null ? ` on ${compactMoney(e.basisAmount, e.currency)}` : ""} · {COMMISSION_STATUSES[e.status]}{e.note ? ` · ${e.note}` : ""}</td>
                  <td>{owner && e.status !== "paid" && e.status !== "void" && (
                    <form action={commissionStatusAction} className={styles.inline}><input type="hidden" name="eventId" value={e.id} />
                      <select name="status" aria-label="Status" defaultValue={e.status === "estimated" ? "approved" : e.status === "approved" ? "invoiced" : "paid"}><option value="approved">Approve</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option><option value="void">Void</option></select>
                      <button className={ui.miniBtn} type="submit">Set</button></form>
                  )}</td></tr>
              ))}</tbody></table>
            )}
            {owner && ags.some(x => x.s) && (
              <details><summary className={ui.sub}>Record a commission</summary>
                <form action={recordCommissionAction} className={styles.grid2} style={{ marginTop: 6 }}>
                  <input type="hidden" name="brokerId" value={b.id} />
                  <label>Schedule<select name="scheduleId" required>{ags.filter(x => x.s).map(({ a, s }) => <option key={s!.id} value={s!.id}>{a.title} · {COMMISSION_TYPES[s!.type]}</option>)}</select></label>
                  <label>Registration<select name="registrationId" defaultValue=""><option value="">None</option>{regs.filter(x => x.brokerId === b.id).map(x => <option key={x.id} value={x.id}>{x.name} ({x.status})</option>)}</select></label>
                  <label>Basis amount<input name="basisAmount" inputMode="decimal" /></label>
                  <label>Note<input name="note" /></label>
                  <button className={ui.miniBtn} type="submit">Record (estimated)</button>
                </form>
              </details>
            )}
          </section>
        );
      })}
    </>
  );
}

async function RoomsTab({ scope, projectRows, docRows, nameOf }: { scope: Scope; projectRows: { id: string; name: string }[]; docRows: { id: string; title: string; version: string }[]; nameOf: Map<string, string> }) {
  const db = appDb();
  const rooms = await db.select().from(dataRooms).where(mandateCondition(scope, dataRooms.mandateId)).orderBy(desc(dataRooms.updatedAt));
  const items = rooms.length ? await db.select().from(dataRoomDocuments).where(inArray(dataRoomDocuments.dataRoomId, rooms.map(x => x.id))) : [];
  const views = rooms.length ? await db.select().from(portalAccessLog).where(and(eq(portalAccessLog.entityType, "document"), inArray(portalAccessLog.entityId, items.map(i => i.documentId).concat("-")))).orderBy(desc(portalAccessLog.at)).limit(50) : [];
  return (
    <div className={r.grid}>
      <div>
        {rooms.length === 0 && <section className={r.panel}><p className={r.empty}>No data rooms.</p></section>}
        {rooms.map(room => (
          <section key={room.id} className={r.panel}>
            <p className={r.panelTitle}><span>{room.name}{room.isDemo ? " · DEMO" : ""}</span><span className={ui.chip}>{room.status}</span></p>
            <p className={ui.sub}>{PORTAL_KINDS[room.audience]} audience · {room.ndaRequired ? `NDA v${room.ndaVersion} required` : "no NDA"}{room.projectId ? ` · ${projectRows.find(p => p.id === room.projectId)?.name ?? ""}` : ""}</p>
            {Object.entries(DATA_ROOM_FOLDERS).map(([k, label]) => {
              const inFolder = items.filter(i => i.dataRoomId === room.id && i.folder === k);
              return inFolder.length ? <p key={k} className={ui.sub}><b>{label}:</b> {inFolder.map(i => docRows.find(d => d.id === i.documentId)?.title ?? "document").join(", ")}</p> : null;
            })}
            <form action={dataRoomAction} className={styles.inline} style={{ marginTop: 8 }}>
              <input type="hidden" name="dataRoomId" value={room.id} />
              <select name="documentId" defaultValue="" aria-label="Add document"><option value="">Add a document…</option>{docRows.map(d => <option key={d.id} value={d.id}>{d.title} v{d.version}</option>)}</select>
              <select name="folder" defaultValue="corporate" aria-label="Folder">{Object.entries(DATA_ROOM_FOLDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select name="status" defaultValue={room.status} aria-label="Status"><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select>
              <label style={{ fontSize: 12 }}><input type="checkbox" name="bumpNda" /> New NDA version</label>
              <button className={ui.miniBtn} type="submit">Save</button>
            </form>
          </section>
        ))}
        <section className={r.panel}>
          <p className={r.panelTitle}>Document views and downloads</p>
          {views.length === 0 ? <p className={r.empty}>No portal opens yet.</p> : <table className={ui.table}><tbody>{views.map(v => <tr key={v.id}><td>{v.at.slice(0, 16).replace("T", " ")}</td><td>{nameOf.get(v.portalUserId)}</td><td>{docRows.find(d => d.id === v.entityId)?.title}</td><td style={{ color: v.allowed ? undefined : "#b0432f" }}>{v.allowed ? "opened" : `denied: ${v.reason}`}</td></tr>)}</tbody></table>}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>New data room</p>
          <form action={createDataRoomAction} className={styles.stack}>
            <label>Name<input name="name" required /></label>
            <label>Project<select name="projectId" defaultValue=""><option value="">None</option>{projectRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Audience<select name="audience" defaultValue="capital">{Object.entries(PORTAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="ndaRequired" defaultChecked /> Confidentiality undertaking required</label>
            <label>Undertaking text (blank = default, marked for counsel review)<textarea name="ndaText" rows={3} /></label>
            <button className="btn btn--primary" type="submit">Create</button>
          </form>
          <p className={ui.sub}>Files open from where they live (Drive, data room links) through a logged gateway; direct uploads arrive with R2.</p>
        </section>
      </aside>
    </div>
  );
}

async function DistributionTab({ scope, owner, docRows }: { scope: Scope; owner: boolean; docRows: { id: string; title: string }[] }) {
  const rows = await appDb().select().from(distributionApprovals).where(mandateCondition(scope, distributionApprovals.mandateId)).orderBy(desc(distributionApprovals.createdAt)).limit(300);
  return (
    <div className={r.grid}>
      <section className={r.panel}>
        <p className={r.panelTitle}>Distribution approvals</p>
        <p className={ui.sub} style={{ marginTop: 0 }}>Capital and introducer portals open a document only under an approved rule for their audience, jurisdiction and dates. Securities-related material also needs a verified licensed introducer or a verified investor qualification.</p>
        {rows.length === 0 ? <p className={r.empty}>No rules yet.</p> : (
          <table className={ui.table}><tbody>{rows.map(a => <tr key={a.id}><td><b>{docRows.find(d => d.id === a.documentId)?.title ?? "Document"}</b> → {PORTAL_KINDS[a.audience]}<span className={ui.sub} style={{ display: "block" }}>{[a.complianceStatus, a.jurisdictions.length ? a.jurisdictions.join(", ") : "any jurisdiction", a.securitiesRelated && "securities-related", a.validFrom && `from ${a.validFrom}`, a.validUntil && `until ${a.validUntil}`, a.approvedBy && `approved by ${a.approvedBy}`].filter(Boolean).join(" · ")}</span></td></tr>)}</tbody></table>
        )}
      </section>
      <aside>
        {owner ? (
          <section className={r.panel}>
            <p className={r.panelTitle}>Add a rule</p>
            <form action={distributionAction} className={styles.stack}>
              <label>Document<select name="documentId" required defaultValue=""><option value="" disabled>Choose</option>{docRows.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
              <label>Audience<select name="audience" defaultValue="capital"><option value="capital">Capital partners</option><option value="broker">Introducers</option></select></label>
              <label>Jurisdictions (blank = any)<input name="jurisdictions" placeholder="US, GB, MX" /></label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="securitiesRelated" /> Securities-related</label>
              <label>Valid from<input name="validFrom" type="date" /></label>
              <label>Valid until<input name="validUntil" type="date" /></label>
              <label>Status<select name="complianceStatus" defaultValue="pending"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
              <button className="btn btn--primary" type="submit">Save</button>
            </form>
          </section>
        ) : <p className={ui.sub}>Distribution approvals are owner-only.</p>}
      </aside>
    </div>
  );
}

async function RequestsTab({ scope, users, projectRows, nameOf }: { scope: Scope; users: PU[]; projectRows: { id: string; name: string }[]; nameOf: Map<string, string> }) {
  const db = appDb();
  const [reqs, ups] = await Promise.all([
    db.select().from(documentRequests).where(mandateCondition(scope, documentRequests.mandateId)).orderBy(asc(documentRequests.status), asc(documentRequests.dueDate)).limit(300),
    db.select().from(projectUpdates).where(mandateCondition(scope, projectUpdates.mandateId)).orderBy(desc(projectUpdates.createdAt)).limit(100),
  ]);
  return (
    <div className={r.grid}>
      <div>
        <section className={r.panel}>
          <p className={r.panelTitle}>Document requests</p>
          {reqs.length === 0 ? <p className={r.empty}>No requests.</p> : (
            <table className={ui.table}><tbody>{reqs.map(x => (
              <tr key={x.id}><td><b>{x.title}</b> <span className={ui.chip}>{REQUEST_STATUSES[x.status]}</span><span className={ui.sub} style={{ display: "block" }}>{[x.portalUserId && `to ${nameOf.get(x.portalUserId)}`, x.projectId && projectRows.find(p => p.id === x.projectId)?.name, x.dueDate && `due ${x.dueDate}`, x.folder && DATA_ROOM_FOLDERS[x.folder]].filter(Boolean).join(" · ")}</span>
                {(x.responseNote || x.responseUrl) && <span className={ui.sub} style={{ display: "block" }}>Response: {x.responseNote} {x.responseUrl && <a href={x.responseUrl} target="_blank" rel="noreferrer">link</a>}</span>}</td>
                <td><form action={reviewRequestAction} className={styles.inline}><input type="hidden" name="requestId" value={x.id} /><select name="status" defaultValue={x.status === "submitted" ? "accepted" : x.status} aria-label="Status">{Object.entries(REQUEST_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={ui.miniBtn} type="submit">Set</button></form></td></tr>
            ))}</tbody></table>
          )}
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Project updates</p>
          {ups.length === 0 ? <p className={r.empty}>No updates.</p> : (
            <table className={ui.table}><tbody>{ups.map(u => (
              <tr key={u.id}><td><b>{u.title}</b> · {projectRows.find(p => p.id === u.projectId)?.name}<span className={ui.sub} style={{ display: "block" }}>{u.audiences.map(a => PORTAL_KINDS[a as keyof typeof PORTAL_KINDS]).join(", ") || "no audience"} · {u.publishedAt ? `published ${u.publishedAt.slice(0, 10)} by ${u.approvedBy}` : "draft"}</span></td>
                <td>{!u.publishedAt && <form action={publishUpdateAction}><input type="hidden" name="updateId" value={u.id} /><button className={ui.miniBtn} type="submit">Approve and publish</button></form>}</td></tr>
            ))}</tbody></table>
          )}
        </section>
      </div>
      <aside>
        <section className={r.panel}>
          <p className={r.panelTitle}>Request information</p>
          <form action={createRequestAction} className={styles.stack}>
            <label>Title<input name="title" required placeholder="e.g. Land title extract" /></label>
            <label>From<select name="portalUserId" defaultValue=""><option value="">Internal only</option>{users.filter(u => u.status === "active" || u.status === "invited").map(u => <option key={u.id} value={u.id}>{u.name || u.email} ({u.kind})</option>)}</select></label>
            <label>Project<select name="projectId" defaultValue=""><option value="">None</option>{projectRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Folder<select name="folder" defaultValue=""><option value="">—</option>{Object.entries(DATA_ROOM_FOLDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Description<textarea name="description" rows={2} /></label>
            <label>Due<input name="dueDate" type="date" /></label>
            <button className="btn" type="submit">Create</button>
          </form>
        </section>
        <section className={r.panel}>
          <p className={r.panelTitle}>Write an update</p>
          <form action={createUpdateAction} className={styles.stack}>
            <label>Project<select name="projectId" required defaultValue=""><option value="" disabled>Choose</option>{projectRows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Title<input name="title" required /></label>
            <label>Text (external audiences read this as written)<textarea name="body" rows={4} required /></label>
            <div className={styles.checks}>{Object.entries(PORTAL_KINDS).map(([k, v]) => <label key={k}><input type="checkbox" name="audiences" value={k} />{v}</label>)}</div>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="publish" /> Approve and publish now</label>
            <button className="btn" type="submit">Save</button>
          </form>
        </section>
      </aside>
    </div>
  );
}

async function IntakeTab() {
  const rows = await appDb().select().from(intakeSubmissions).orderBy(asc(intakeSubmissions.status), desc(intakeSubmissions.createdAt)).limit(200);
  return (
    <section className={r.panel}>
      <p className={r.panelTitle}>Public intake</p>
      {rows.length === 0 ? <p className={r.empty}>No submissions.</p> : (
        <table className={ui.table}><tbody>{rows.map(x => (
          <tr key={x.id}>
            <td><b>{x.name}</b>{x.organization ? ` · ${x.organization}` : ""} <span className={ui.chip}>{INTAKE_KINDS[x.kind]}</span> <span className={ui.chip}>{INTAKE_STATUSES[x.status]}</span>
              <span className={ui.sub} style={{ display: "block" }}>{x.email} · {x.createdAt.slice(0, 10)}</span>
              <span className={ui.sub} style={{ display: "block", whiteSpace: "pre-wrap" }}>{Object.entries(x.payload).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")}</span></td>
            <td>{x.status !== "converted" && (
              <form action={intakeAction} className={styles.inline}><input type="hidden" name="submissionId" value={x.id} />
                <select name="decision" defaultValue="convert" aria-label="Decision"><option value="convert">Convert</option><option value="reviewing">Reviewing</option><option value="rejected">Reject</option><option value="spam">Spam</option></select>
                <button className={ui.miniBtn} type="submit">Apply</button></form>
            )}</td>
          </tr>
        ))}</tbody></table>
      )}
    </section>
  );
}

async function MessagesTab({ scope, nameOf }: { scope: Scope; nameOf: Map<string, string> }) {
  const rows = await appDb().select().from(portalMessages).where(mandateCondition(scope, portalMessages.mandateId)).orderBy(desc(portalMessages.createdAt)).limit(200);
  const threads = [...new Set(rows.map(m => m.portalUserId))];
  return (
    <>
      {threads.length === 0 && <section className={r.panel}><p className={r.empty}>No portal messages.</p></section>}
      {threads.map(id => {
        const ms = rows.filter(m => m.portalUserId === id);
        const unread = ms.some(m => m.direction === "in" && !m.readAt);
        return (
          <section key={id} className={r.panel}>
            <p className={r.panelTitle}><span>{nameOf.get(id)}</span>{unread && <span className={ui.chip} style={{ color: "#b0432f" }}>Unread</span>}</p>
            <ul className={r.timeline}>{ms.slice(0, 8).map(m => <li key={m.id}><span className={r.when}>{m.createdAt.slice(0, 10)}</span><span style={{ whiteSpace: "pre-wrap" }}><b>{m.direction === "in" ? "Them" : m.author}</b>: {m.body}</span></li>)}</ul>
            <form action={replyPortalAction} className={styles.inline} style={{ marginTop: 8 }}><input type="hidden" name="portalUserId" value={id} /><input name="body" placeholder="Reply (shown in their portal)" aria-label="Reply" style={{ flex: 1 }} required /><button className={ui.miniBtn} type="submit">Reply</button></form>
          </section>
        );
      })}
    </>
  );
}

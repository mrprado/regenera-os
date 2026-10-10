// Client workspace (phase 29C). A client portal user sees only engagements they hold a live grant for, in their own
// workspace, and only client-facing fields: no internal notes, costs, rates, margins, conflict notes, partner costs,
// speculative matches or other clients' records. Every action re-checks the grant on the server and is logged.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { changeRequests, clientRequests, engagementDeliverables, engagementMilestones, engagements, invoices, offerProposalVersions, organizations } from "@/db/schema";
import { decideChange, moveDeliverable, submitClientRequest } from "@/lib/lifecycle/delivery";
import { activeGrant, grantedIds, logAccess } from "./access";
import type { PortalUser } from "./guard";

const SHOWN_INVOICE = ["sent", "viewed", "due", "overdue", "paid", "partially_paid"];

/** Engagements this user may see: a live grant, in the user's own workspace. */
export async function clientEngagementIds(db: Db, user: PortalUser, now = new Date()) {
  const ids = await grantedIds(db, user, "engagement", now);
  if (!ids.length) return [];
  return (await db.select({ id: engagements.id }).from(engagements).where(and(inArray(engagements.id, ids), eq(engagements.mandateId, user.mandateId)))).map(e => e.id);
}

export async function clientView(db: Db, user: PortalUser, now = new Date()) {
  const ids = await clientEngagementIds(db, user, now);
  if (!ids.length) return { engagements: [] as ReturnType<typeof shape>[] };
  const [es, ms, ds, rs, cs, invs] = await Promise.all([
    db.select().from(engagements).where(inArray(engagements.id, ids)),
    db.select().from(engagementMilestones).where(inArray(engagementMilestones.engagementId, ids)).orderBy(asc(engagementMilestones.sort)),
    db.select().from(engagementDeliverables).where(inArray(engagementDeliverables.engagementId, ids)).orderBy(asc(engagementDeliverables.dueDate)),
    db.select().from(clientRequests).where(inArray(clientRequests.engagementId, ids)).orderBy(asc(clientRequests.dueDate)),
    db.select().from(changeRequests).where(inArray(changeRequests.engagementId, ids)),
    db.select().from(invoices).where(inArray(invoices.engagementId, ids)),
  ]);
  const versionIds = es.map(e => e.acceptedVersionId).filter((x): x is string => !!x);
  const vs = versionIds.length ? await db.select().from(offerProposalVersions).where(inArray(offerProposalVersions.id, versionIds)) : [];
  const orgIds = es.map(e => e.orgId).filter((x): x is string => !!x);
  const os = orgIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)) : [];
  await logAccess(db, user, "client_view", "engagement", null, true, `${ids.length} engagement(s)`);
  return { engagements: es.map(e => shape(e, os.find(o => o.id === e.orgId)?.name ?? null, vs.find(v => v.id === e.acceptedVersionId) ?? null, ms.filter(m => m.engagementId === e.id), ds.filter(d => d.engagementId === e.id), rs.filter(r => r.engagementId === e.id && r.status !== "cancelled"), cs.filter(c => c.engagementId === e.id && c.status !== "withdrawn"), invs.filter(i => i.engagementId === e.id && SHOWN_INVOICE.includes(i.status)))) };
}

type E = typeof engagements.$inferSelect;
/** Only client-facing fields leave this function. */
function shape(e: E, client: string | null, v: typeof offerProposalVersions.$inferSelect | null, ms: (typeof engagementMilestones.$inferSelect)[], ds: (typeof engagementDeliverables.$inferSelect)[], rs: (typeof clientRequests.$inferSelect)[], cs: (typeof changeRequests.$inferSelect)[], invs: (typeof invoices.$inferSelect)[]) {
  return {
    id: e.id, name: e.name, client, status: e.status, startDate: e.startDate, endDate: e.endDate, currency: e.currency,
    agreedScope: v ? { version: v.version, scope: v.scope, deliverables: v.deliverables.map(d => d.label), exclusions: v.exclusions, responsibilities: v.responsibilities, acceptedOn: v.decidedAt?.slice(0, 10) ?? null } : null,
    milestones: ms.map(m => ({ id: m.id, label: m.label, dueDate: m.dueDate, status: m.status })),
    // Work not yet done internally is shown as in progress; internal blockers are not shown unless they wait on the client.
    deliverables: ds.map(d => ({ id: d.id, milestoneId: d.milestoneId, label: d.label, dueDate: d.dueDate, version: d.version, status: d.status === "in_client_review" ? "review" as const : d.status === "accepted" ? "accepted" as const : d.status === "revision_requested" ? "revising" as const : "in_progress" as const, waitingOnYou: d.status === "blocked" && /client/i.test(d.blockedParty ?? "") ? d.blockedReason : null, artifactUrl: d.status === "in_client_review" || d.status === "accepted" ? d.artifactUrl : null, acceptedBy: d.acceptedBy, acceptedAt: d.acceptedAt?.slice(0, 10) ?? null })),
    requests: rs.map(r => ({ id: r.id, label: r.label, description: r.description, dueDate: r.dueDate, status: r.status, response: r.response, reviewNote: r.status === "rejected" ? r.reviewNote : null })),
    changes: cs.map(c => ({ id: c.id, title: c.title, scopeEffect: c.scopeEffect, feeImpact: c.feeImpact, currency: c.currency, timelineWeeks: c.timelineWeeks, status: c.status })),
    invoices: invs.map(i => ({ id: i.id, number: i.number, amount: i.amount, currency: i.currency, issueDate: i.issueDate, dueDate: i.dueDate, paidAmount: i.paidAmount, status: i.status })),
  };
}

async function guard(db: Db, user: PortalUser, engagementId: string, action: string) {
  const [e] = await db.select({ id: engagements.id, mandateId: engagements.mandateId }).from(engagements).where(eq(engagements.id, engagementId));
  const g = e && e.mandateId === user.mandateId ? await activeGrant(db, user, "engagement", engagementId) : null;
  await logAccess(db, user, action, "engagement", engagementId, !!g, g ? "" : "no live grant");
  if (!g) throw new Error("Not authorized");
}
const who = (u: PortalUser) => `${u.name || u.email} (client portal)`;

export async function clientDecideDeliverable(db: Db, user: PortalUser, deliverableId: string, decision: "accept" | "revise", note: string) {
  const [d] = await db.select({ engagementId: engagementDeliverables.engagementId, status: engagementDeliverables.status }).from(engagementDeliverables).where(eq(engagementDeliverables.id, deliverableId));
  if (!d) throw new Error("Not authorized");
  await guard(db, user, d.engagementId, `deliverable_${decision}`);
  if (d.status !== "in_client_review") throw new Error("This deliverable is not waiting for your review.");
  if (decision === "accept") await moveDeliverable(db, deliverableId, "accepted", { by: who(user), clientName: user.name || user.email, note: note.trim() || "Accepted in the client portal" });
  else await moveDeliverable(db, deliverableId, "revision_requested", { by: who(user), note });
}

export async function clientRespondRequest(db: Db, user: PortalUser, requestId: string, response: string) {
  const [r] = await db.select({ engagementId: clientRequests.engagementId }).from(clientRequests).where(eq(clientRequests.id, requestId));
  if (!r) throw new Error("Not authorized");
  await guard(db, user, r.engagementId, "client_request_response");
  await submitClientRequest(db, requestId, { response, by: who(user) });
}

export async function clientDecideChange(db: Db, user: PortalUser, changeId: string, decision: "approved" | "rejected") {
  const [c] = await db.select({ engagementId: changeRequests.engagementId }).from(changeRequests).where(eq(changeRequests.id, changeId));
  if (!c) throw new Error("Not authorized");
  await guard(db, user, c.engagementId, `change_${decision}`);
  await decideChange(db, changeId, decision, `${decision === "approved" ? "Approved" : "Declined"} in the client portal by ${user.name || user.email} on ${new Date().toISOString().slice(0, 10)}`, who(user));
}

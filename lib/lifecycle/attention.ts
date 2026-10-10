// Next actions and stalls across the commercial lifecycle (phase 29D), for Today's attention list. Every active
// opportunity, relationship, partnership and engagement should have a next action or a stated reason for none;
// overdue actions, proposals waiting, missing client documents, reviews waiting on the client, renewals and quiet
// relationships are surfaced with the record to open. Rules are fixed and visible; nothing is scored.
import { and, eq, inArray, isNotNull, isNull, lte, notInArray } from "drizzle-orm";
import type { Db } from "@/db";
import { clientRequests, contacts, deals, engagementDeliverables, engagements, offerProposals, offerProposalVersions, organizations, partnerships, relationshipIntroductions, relationshipStatus, tasks } from "@/db/schema";
import { commercialStageOf } from "./pipeline";
import { COMMERCIAL_STAGES } from "./vocab";

export type LifecycleItem = { key: string; entity: string; issue: string; severity: "critical" | "high" | "medium" | "low"; due: string | null; href: string; category: string };
const daysAgo = (today: string, n: number) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (today: string, n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const RULES = { proposalWaitDays: 10, clientReviewDays: 7, quietDays: 90, renewalDays: 60 };

export async function lifecycleAttention(db: Db, mandateIds: string[], today = new Date().toISOString().slice(0, 10)): Promise<LifecycleItem[]> {
  if (!mandateIds.length) return [];
  const items: LifecycleItem[] = [];
  const [openDeals, openTasks] = await Promise.all([
    db.select().from(deals).where(and(inArray(deals.mandateId, mandateIds), isNull(deals.archivedAt), notInArray(deals.stage, ["signed", "active", "expansion", "completed", "churned", "lost"]))),
    db.select({ dealId: tasks.dealId, contactId: tasks.contactId, orgId: tasks.orgId, workstream: tasks.workstream }).from(tasks).where(and(inArray(tasks.mandateId, mandateIds), eq(tasks.status, "open"))),
  ]);
  const taskDeal = new Set(openTasks.map(t => t.dealId).filter(Boolean));
  for (const d of openDeals) {
    const stage = commercialStageOf(d);
    if (stage === "deferred") continue;
    if (!d.nextAction?.trim() && !taskDeal.has(d.id)) items.push({ key: `lc:deal-next:${d.id}`, entity: d.name, issue: `No next action (${COMMERCIAL_STAGES[stage]})`, severity: "medium", due: null, href: `/deals/${d.id}#commercial`, category: "Commercial" });
    else if (d.nextActionDate && d.nextActionDate < today) items.push({ key: `lc:deal-late:${d.id}`, entity: d.name, issue: `Next action overdue: ${d.nextAction}`, severity: "high", due: d.nextActionDate, href: `/deals/${d.id}#commercial`, category: "Commercial" });
  }

  const sent = await db.select({ p: offerProposals, v: offerProposalVersions }).from(offerProposals).innerJoin(offerProposalVersions, and(eq(offerProposalVersions.proposalId, offerProposals.id), eq(offerProposalVersions.status, "sent"))).where(and(inArray(offerProposals.mandateId, mandateIds), eq(offerProposals.status, "sent")));
  for (const { p, v } of sent) {
    if (v.validUntil && v.validUntil < today) items.push({ key: `lc:prop-exp:${p.id}`, entity: p.title, issue: `Proposal v${v.version} expired on ${v.validUntil}: send a new version or close`, severity: "high", due: v.validUntil, href: `/commercial/proposals/${p.id}`, category: "Commercial" });
    else if (v.sentAt && v.sentAt.slice(0, 10) <= daysAgo(today, RULES.proposalWaitDays)) items.push({ key: `lc:prop-wait:${p.id}`, entity: p.title, issue: `Proposal awaiting a decision since ${v.sentAt.slice(0, 10)}`, severity: "medium", due: v.validUntil, href: `/commercial/proposals/${p.id}`, category: "Commercial" });
  }

  const rels = await db.select().from(relationshipStatus).where(and(inArray(relationshipStatus.mandateId, mandateIds), inArray(relationshipStatus.stage, ["identified", "connected", "engaged", "qualified", "active", "nurture"])));
  const relName = new Map<string, string>();
  const cIds = rels.filter(r => r.entityType === "contact").map(r => r.entityId), oIds = rels.filter(r => r.entityType === "organization").map(r => r.entityId);
  if (cIds.length) for (const c of await db.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(inArray(contacts.id, cIds.slice(0, 90)))) relName.set(c.id, c.name);
  if (oIds.length) for (const o of await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, oIds.slice(0, 90)))) relName.set(o.id, o.name);
  const taskFor = new Set(openTasks.flatMap(t => [t.contactId, t.orgId]).filter(Boolean));
  for (const s of rels) {
    const href = `${s.entityType === "contact" ? "/people" : "/companies"}/${s.entityId}#relationship`, entity = relName.get(s.entityId) ?? "Relationship";
    if (!s.nextAction.trim() && !s.noActionReason && !taskFor.has(s.entityId)) items.push({ key: `lc:rel-next:${s.id}`, entity, issue: "No next action or reason recorded", severity: "low", due: null, href, category: "Relationships" });
    else if (s.nextActionDue && s.nextActionDue < today) items.push({ key: `lc:rel-late:${s.id}`, entity, issue: `Follow-up overdue: ${s.nextAction}`, severity: "medium", due: s.nextActionDue, href, category: "Relationships" });
    const last = s.lastMeaningfulAt ?? s.stageChangedAt;
    if (["engaged", "qualified", "active"].includes(s.stage) && last.slice(0, 10) <= daysAgo(today, RULES.quietDays) && !(s.nextActionDue && s.nextActionDue >= today)) items.push({ key: `lc:rel-quiet:${s.id}`, entity, issue: `No meaningful contact since ${last.slice(0, 10)}`, severity: "low", due: null, href, category: "Relationships" });
  }

  const ps = await db.select({ p: partnerships, name: organizations.name }).from(partnerships).innerJoin(organizations, eq(organizations.id, partnerships.orgId)).where(and(inArray(partnerships.mandateId, mandateIds), notInArray(partnerships.stage, ["closed"])));
  for (const { p, name } of ps) if (!p.nextAction.trim() && !p.noActionReason && !taskFor.has(p.orgId)) items.push({ key: `lc:prt-next:${p.id}`, entity: name, issue: `Partnership (${p.stage.replace(/_/g, " ")}) has no next action`, severity: "low", due: null, href: `/companies/${p.orgId}#partnership`, category: "Relationships" });

  const intros = await db.select().from(relationshipIntroductions).where(and(inArray(relationshipIntroductions.mandateId, mandateIds), isNotNull(relationshipIntroductions.openKey), lte(relationshipIntroductions.nextActionDue, today)));
  for (const i of intros) items.push({ key: `lc:intro:${i.id}`, entity: i.purpose, issue: `Introduction follow-up overdue: ${i.nextAction || "record the outcome"}`, severity: "medium", due: i.nextActionDue, href: `/companies/${i.fromOrgId}#introductions`, category: "Relationships" });

  const live = await db.select().from(engagements).where(and(inArray(engagements.mandateId, mandateIds), inArray(engagements.status, ["contracting", "active", "waiting_on_client", "on_hold", "renewal"])));
  const eIds = live.map(e => e.id);
  if (eIds.length) {
    const [reqs, dels] = await Promise.all([
      db.select().from(clientRequests).where(and(inArray(clientRequests.engagementId, eIds), inArray(clientRequests.status, ["open", "rejected", "submitted"]))),
      db.select().from(engagementDeliverables).where(and(inArray(engagementDeliverables.engagementId, eIds), notInArray(engagementDeliverables.status, ["accepted"]))),
    ]);
    const name = new Map(live.map(e => [e.id, e.name]));
    for (const r of reqs) {
      if (r.status === "submitted") items.push({ key: `lc:req-review:${r.id}`, entity: name.get(r.engagementId)!, issue: `Client sent: ${r.label} (review it)`, severity: "medium", due: null, href: `/commercial/engagements/${r.engagementId}#delivery`, category: "Delivery" });
      else if (r.dueDate && r.dueDate < today) items.push({ key: `lc:req-late:${r.id}`, entity: name.get(r.engagementId)!, issue: `Missing from the client: ${r.label}`, severity: "high", due: r.dueDate, href: `/commercial/engagements/${r.engagementId}#delivery`, category: "Delivery" });
    }
    for (const d of dels) {
      if (d.status === "in_client_review" && d.updatedAt.slice(0, 10) <= daysAgo(today, RULES.clientReviewDays)) items.push({ key: `lc:del-review:${d.id}`, entity: name.get(d.engagementId)!, issue: `Waiting for the client's review: ${d.label}`, severity: "medium", due: null, href: `/commercial/engagements/${d.engagementId}#delivery`, category: "Delivery" });
      else if (d.dueDate && d.dueDate < today && !["internal_done", "in_client_review"].includes(d.status)) items.push({ key: `lc:del-late:${d.id}`, entity: name.get(d.engagementId)!, issue: `Deliverable overdue: ${d.label}${d.status === "blocked" ? ` (blocked: ${d.blockedReason})` : ""}`, severity: "high", due: d.dueDate, href: `/commercial/engagements/${d.engagementId}#delivery`, category: "Delivery" });
    }
    for (const e of live) {
      if (e.status === "active" && !dels.some(d => d.engagementId === e.id) && !e.deliverables.length) items.push({ key: `lc:eng-plan:${e.id}`, entity: e.name, issue: "Active engagement with no open deliverable: complete it or add the next piece of work", severity: "low", due: null, href: `/commercial/engagements/${e.id}#delivery`, category: "Delivery" });
      const renewal = e.renewalDate ?? (e.monthlyFee > 0 ? e.endDate : null);
      if (renewal && renewal >= today && renewal <= daysAhead(today, RULES.renewalDays)) items.push({ key: `lc:renew:${e.id}`, entity: e.name, issue: `Renewal or end on ${renewal}: decide continuation with the client`, severity: "medium", due: renewal, href: `/commercial/engagements/${e.id}`, category: "Commercial" });
    }
  }
  return items;
}


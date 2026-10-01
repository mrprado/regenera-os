"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bidLibrary, contacts, fundingMatches, fundingOpportunities, messages, organizations } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { bidOnOpportunity, matchApplicants } from "@/lib/funding/engine";
import { enqueue } from "@/lib/jobs/queue";
import { validateMessage } from "@/lib/style/validate";

const zId = z.string().uuid();
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

async function scopedOpportunity(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [o] = await appDb().select().from(fundingOpportunities).where(and(eq(fundingOpportunities.id, id), mandateCondition(scope, fundingOpportunities.mandateId)));
  if (!o) throw new Error("Opportunity not found");
  return o;
}

export async function bidAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await scopedOpportunity(user.scope, id);
    const dealId = await bidOnOpportunity(appDb(), id, user.email);
    await audit(appDb(), { actor: user.email, action: "funding_bid", entity: "funding_opportunities", entityId: id, after: { dealId } });
  });
  redirect(note(`/funding/${id}`, "Bid opened: a deal with the deadline as its close date, and tasks planned back from the deadline (see Tasks)."));
}

export async function findApplicantsAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let n = 0;
  await withOsUser(async user => {
    await scopedOpportunity(user.scope, id);
    n = await matchApplicants(appDb(), id);
  });
  redirect(note(`/funding/${id}`, n ? `${n} organizations in the CRM look eligible.` : "No eligible organizations in the CRM yet. Use the playbooks to find some."));
}

export async function decideFundingAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const decision = z.enum(["watching", "dismissed", "new"]).parse(formData.get("decision"));
  const reason = z.string().trim().max(200).optional().parse((formData.get("reason") as string) || undefined);
  const back = z.string().startsWith("/funding").catch("/funding").parse(formData.get("back"));
  await withOsUser(async user => {
    await scopedOpportunity(user.scope, id);
    await appDb().update(fundingOpportunities).set({ decision, dismissReason: decision === "dismissed" ? reason ?? "Not a fit" : null, updatedAt: new Date().toISOString() }).where(eq(fundingOpportunities.id, id));
  });
  redirect(back);
}

export async function draftProposalAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await scopedOpportunity(user.scope, id);
    await enqueue(appDb(), "funding.draft", { opportunityId: id }, { dedupeKey: `funding-draft:${id}:${new Date().toISOString().slice(0, 15)}` });
  });
  redirect(note(`/funding/${id}`, aiConfig() ? "Claude is drafting the proposal sections. They appear here after the next job tick." : "Drafting needs ANTHROPIC_API_KEY. The request is queued and runs once the key is set."));
}

/** Drafts an application-support note to the matched organization's first contact, into the approval queue. */
export async function offerSupportAction(formData: FormData) {
  const matchId = zId.parse(formData.get("matchId"));
  let text = "";
  let oppId = "";
  await withOsUser(async user => {
    const db = appDb();
    const [m] = await db.select().from(fundingMatches).where(and(eq(fundingMatches.id, matchId), mandateCondition(user.scope, fundingMatches.mandateId)));
    if (!m) throw new Error("Match not found");
    oppId = m.opportunityId;
    const [o] = await db.select().from(fundingOpportunities).where(eq(fundingOpportunities.id, m.opportunityId));
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, m.orgId));
    const [c] = await db.select().from(contacts).where(and(eq(contacts.orgId, m.orgId), eq(contacts.suppressed, false))).limit(20).then(rows => rows.filter(r => r.emailLower));
    if (!c) { text = `${org?.name ?? "This organization"} has no contact with an email address yet.`; return; }
    const first = c.firstName || c.fullName.split(" ")[0];
    const subject = `${o.funder ?? "Funding"} call closing ${o.deadline ?? "soon"}`;
    const body = `${first}, ${o.funder ?? "a funder"} has an open call that looks relevant to ${org?.name ?? "your organization"}: "${o.title.slice(0, 140)}", closing ${o.deadline ?? "soon"}. Regenera helps sponsors test eligibility, shape the project case and prepare the application. Would a short call this week to check fit be useful?`;
    const issues = validateMessage({ subject, body }, { firstTouch: true, advisory: true });
    await db.insert(messages).values({
      mandateId: m.mandateId, contactId: c.id, channel: "email", direction: "out", mailboxRole: "primary", toEmail: c.emailLower!, subject, body,
      status: issues.length ? "style_failed" : "pending_approval", tier: "targeted", angleTag: "funding", scheduledAt: new Date().toISOString(), styleIssues: issues.length ? issues : null,
    });
    await db.update(fundingMatches).set({ status: "contacted", updatedAt: new Date().toISOString() }).where(eq(fundingMatches.id, m.id));
    text = `Draft to ${c.fullName} is in the approval queue.`;
  });
  redirect(note(`/funding/${oppId}`, text));
}

export async function scanFundingNowAction() {
  await withOsUser(async user => {
    await enqueue(appDb(), "funding.scan", { manual: true }, { dedupeKey: `funding-scan:manual:${new Date().toISOString().slice(0, 15)}` });
    await audit(appDb(), { actor: user.email, action: "funding_scan_requested", entity: "funding_opportunities" });
  }, { owner: true });
  redirect(note("/funding", "Funding scan queued. It runs on the next job tick, a few sources at a time."));
}

export async function saveLibraryAction(formData: FormData) {
  const id = zId.optional().catch(undefined).parse(formData.get("id") || undefined);
  const kind = z.enum(["profile", "methodology", "cv", "past_performance", "other", "narrative", "boilerplate", "project", "impact", "mande", "risk", "budgeting", "prior_response", "study"]).parse(formData.get("kind"));
  const title = z.string().trim().min(1).max(200).parse(formData.get("title"));
  const body = z.string().trim().min(1).max(8000).parse(formData.get("body"));
  const caseRecordId = zId.optional().catch(undefined).parse(formData.get("caseRecordId") || undefined) ?? null;
  await withOsUser(async user => {
    const db = appDb();
    const mandateId = user.scope.ownerOf[0] ?? user.scope.mandateIds[0];
    if (id) await db.update(bidLibrary).set({ kind, title, body, caseRecordId, updatedAt: new Date().toISOString() }).where(and(eq(bidLibrary.id, id), mandateCondition(user.scope, bidLibrary.mandateId)));
    else await db.insert(bidLibrary).values({ mandateId, kind, title, body, caseRecordId, approved: true, approvedBy: user.email, owner: user.email });
  });
  redirect(note("/funding?tab=library", "Saved."));
}

export async function deleteLibraryAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await appDb().delete(bidLibrary).where(and(eq(bidLibrary.id, id), mandateCondition(user.scope, bidLibrary.mandateId)));
  });
  redirect("/funding?tab=library");
}

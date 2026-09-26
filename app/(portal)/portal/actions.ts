"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bids, dataRooms, documentRequests, ndaAcceptances, organizations, portalMessages, procurementPackages } from "@/db/schema";
import { audit } from "@/lib/audit";
import { appDb } from "@/lib/db/scoped";
import { activeGrant, logAccess, visibleOpportunities } from "@/lib/portal/access";
import { registerReferral } from "@/lib/portal/broker";
import { currentPortalUser, requestIp, withPortalUser } from "@/lib/portal/guard";
import { brokerIdFor } from "@/lib/portal/views";
import { REFERRAL_TARGETS } from "@/lib/portal/vocab";

const zId = z.string().uuid();
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

async function anyUser() {
  const u = await currentPortalUser();
  if (!u) throw new Error("Not authorized");
  return u;
}

export async function sendPortalMessageAction(formData: FormData) {
  const body = z.string().trim().min(1).max(4000).parse(formData.get("body"));
  const u = await anyUser();
  await appDb().insert(portalMessages).values({ mandateId: u.mandateId, portalUserId: u.id, direction: "in", body, author: u.name || u.email });
  redirect(note(`/portal/${u.kind}?tab=messages`, "Message sent to Regenera."));
}

export async function respondRequestAction(formData: FormData) {
  const requestId = zId.parse(formData.get("requestId"));
  const u = await anyUser();
  const [r] = await appDb().select().from(documentRequests).where(and(eq(documentRequests.id, requestId), eq(documentRequests.portalUserId, u.id)));
  if (!r) throw new Error("Request not found");
  const url = str(formData, "responseUrl", 1000);
  if (url && !/^https:\/\//.test(url)) throw new Error("Use an https link (Drive, Dropbox, data room)");
  await appDb().update(documentRequests).set({ status: "submitted", responseNote: str(formData, "responseNote", 3000), responseUrl: url || null, respondedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(documentRequests.id, r.id));
  await audit(appDb(), { actor: `portal:${u.id}`, action: "request_responded", entity: "document_requests", entityId: r.id });
  redirect(note(`/portal/${u.kind}?tab=requests`, "Submitted. Regenera will review it."));
}

export async function acceptNdaAction(formData: FormData) {
  const roomId = zId.parse(formData.get("dataRoomId"));
  const name = z.string().trim().min(2).max(120).parse(formData.get("name"));
  if (formData.get("agree") !== "on") throw new Error("Tick the box to accept");
  const u = await anyUser();
  const [room] = await appDb().select().from(dataRooms).where(and(eq(dataRooms.id, roomId), eq(dataRooms.mandateId, u.mandateId)));
  if (!room || !(await activeGrant(appDb(), u, "data_room", room.id))) throw new Error("Data room not available");
  const [done] = await appDb().select({ id: ndaAcceptances.id }).from(ndaAcceptances).where(and(eq(ndaAcceptances.dataRoomId, room.id), eq(ndaAcceptances.portalUserId, u.id), eq(ndaAcceptances.ndaVersion, room.ndaVersion)));
  const ip = await requestIp();
  if (!done) await appDb().insert(ndaAcceptances).values({ dataRoomId: room.id, portalUserId: u.id, ndaVersion: room.ndaVersion, name, ip });
  await logAccess(appDb(), u, "nda_accepted", "data_room", room.id, true, `version ${room.ndaVersion}`, ip);
  redirect(note(`/portal/${u.kind}?tab=documents`, "Undertaking accepted. The data room is open."));
}

export async function registerReferralAction(formData: FormData) {
  const targetType = z.enum(Object.keys(REFERRAL_TARGETS) as [keyof typeof REFERRAL_TARGETS]).parse(formData.get("targetType"));
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  let status = "";
  await withPortalUser("broker", async u => {
    const brokerId = await brokerIdFor(appDb(), u);
    if (!brokerId) throw new Error("No introducer profile");
    const email = str(formData, "contactEmail", 254).toLowerCase();
    const r = await registerReferral(appDb(), brokerId, {
      targetType, name, organization: str(formData, "organization", 200), contactEmail: z.string().email().safeParse(email).success ? email : null,
      jurisdiction: str(formData, "jurisdiction", 8).toUpperCase() || null, relationship: str(formData, "relationship", 2000), intendedIntroduction: str(formData, "intendedIntroduction", 2000),
      notes: str(formData, "notes", 2000), evidence: str(formData, "evidence", 1000),
    });
    status = r.status;
  });
  redirect(note("/portal/broker?tab=referrals", status === "conflict_review" ? "Registered. It needs a conflict review before a decision; registration does not create any fee entitlement." : "Registered for review. Registration does not create any fee entitlement."));
}

export async function submitProposalAction(formData: FormData) {
  const packageId = zId.parse(formData.get("packageId"));
  await withPortalUser("partner", async u => {
    if (!(await activeGrant(appDb(), u, "procurement_package", packageId))) throw new Error("Not available");
    const [pkg] = await appDb().select().from(procurementPackages).where(eq(procurementPackages.id, packageId));
    if (!pkg || !["rfi", "rfp", "clarification", "bafo"].includes(pkg.stage)) throw new Error("This package is not accepting proposals");
    if (!u.orgId) throw new Error("Your portal account is not linked to an organization; message Regenera");
    const [org] = await appDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, u.orgId));
    const values = {
      price: num(formData, "price"), currency: str(formData, "currency", 8) || pkg.currency, scheduleWeeks: num(formData, "scheduleWeeks"), leadTimeWeeks: num(formData, "leadTimeWeeks"),
      warrantyYears: num(formData, "warrantyYears"), originCountry: str(formData, "originCountry", 80) || null, exceptions: str(formData, "exceptions", 3000),
      status: "received" as const, submittedAt: new Date().toISOString().slice(0, 10), updatedAt: new Date().toISOString(),
    };
    const [own] = await appDb().select({ id: bids.id }).from(bids).where(and(eq(bids.packageId, pkg.id), eq(bids.orgId, u.orgId)));
    if (own) await appDb().update(bids).set(values).where(eq(bids.id, own.id));
    else await appDb().insert(bids).values({ ...values, packageId: pkg.id, projectId: pkg.projectId, mandateId: pkg.mandateId, orgId: u.orgId, bidder: org?.name ?? u.name });
    await audit(appDb(), { actor: `portal:${u.id}`, action: "proposal_submitted", entity: "procurement_packages", entityId: pkg.id, after: { price: values.price } });
  });
  redirect(note("/portal/partner?tab=opportunities", "Proposal submitted. You can revise it until the package closes."));
}

export async function expressInterestAction(formData: FormData) {
  const opportunityId = zId.parse(formData.get("opportunityId"));
  await withPortalUser("capital", async u => {
    const o = (await visibleOpportunities(appDb(), u)).find(x => x.id === opportunityId);
    if (!o) throw new Error("Not available");
    const text = str(formData, "message", 2000);
    await appDb().insert(portalMessages).values({ mandateId: u.mandateId, portalUserId: u.id, entityType: "capital_opportunity", entityId: o.id, direction: "in", author: u.name || u.email, body: `Interested in ${o.title}.${text ? ` ${text}` : ""}` });
    await logAccess(appDb(), u, "interest", "capital_opportunity", o.id, true);
  });
  redirect(note("/portal/capital?tab=opportunities", "Thank you. Regenera will follow up; nothing is committed by expressing interest."));
}

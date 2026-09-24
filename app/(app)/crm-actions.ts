"use server";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { activities, contacts, listMembers, lists, organizations } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { apolloConfig, sendPolicy } from "@/lib/config";
import { getAccessToken } from "@/lib/google/accounts";
import { googleConfig } from "@/lib/google/config";
import { claimMessage, composeManualEmail, sendClaimedMessage } from "@/lib/crm/send";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { requestResearch } from "@/lib/crm/research";
import { enrichContactWithApollo } from "@/lib/crm/contact-email";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { enqueue } from "@/lib/jobs/queue";

const safeBack = (v: FormDataEntryValue | null, fallback: string) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
};
const withNotice = (back: string, notice: string) => `${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(notice)}`;
const ids = (fd: FormData) => z.array(z.string().uuid()).max(500).parse(fd.getAll("ids"));

// ---------- Apollo: save search results ----------
const zApolloPick = z.object({
  id: z.string(), first_name: z.string().nullish(), last_name: z.string().nullish(), name: z.string().nullish(),
  title: z.string().nullish(), seniority: z.string().nullish(), linkedin_url: z.string().nullish(),
  city: z.string().nullish(), state: z.string().nullish(), country: z.string().nullish(),
  org: z.object({ id: z.string().nullish(), name: z.string().nullish(), domain: z.string().nullish(), website: z.string().nullish(), industry: z.string().nullish(), headcount: z.number().nullish(), city: z.string().nullish(), country: z.string().nullish(), linkedin_url: z.string().nullish() }).nullish(),
});

export async function saveApolloPeople(formData: FormData) {
  const picks = formData.getAll("pick").map(v => zApolloPick.parse(JSON.parse(String(v))));
  const segmentId = z.string().uuid().optional().catch(undefined).parse(formData.get("segment") || undefined);
  const enrich = formData.get("enrich") === "1";
  const back = safeBack(formData.get("back"), "/people?tab=apollo");
  if (picks.length === 0) redirect(withNotice(back, "Select at least one person."));
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const mandateId = user.scope.ownerOf[0] ?? user.scope.mandateIds[0];
    let saved = 0, enriched = 0, credits = 0;
    const errors: string[] = [];
    for (const p of picks) {
      let orgId: string | null = null;
      if (p.org?.name) {
        const o = await upsertOrganization(db, mandateId, {
          name: p.org.name, domain: p.org.domain, website: p.org.website, industry: p.org.industry, headcount: p.org.headcount ?? null,
          location: [p.org.city, p.org.country].filter(Boolean).join(", ") || null, apolloOrgId: p.org.id ?? null,
          linkedinUrl: p.org.linkedin_url, segmentId: segmentId ?? null,
        }, "apollo", { source: "apollo" });
        orgId = o.row.id;
        if (o.created) {
          await enqueue(db, "identity.enrich", { orgId }, { dedupeKey: `identity:${orgId}` });
        }
      }
      const fullName = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown";
      const c = await upsertContact(db, mandateId, {
        fullName, firstName: p.first_name, lastName: p.last_name, title: p.title, seniority: p.seniority, linkedinUrl: p.linkedin_url,
        location: [p.city, p.state, p.country].filter(Boolean).join(", ") || null, country: p.country, apolloPersonId: p.id, orgId, segmentId: segmentId ?? null,
      }, "apollo", { source: "apollo" });
      saved++;
      if (enrich) {
        const r = await enrichApollo(db, mandateId, c.row.id);
        if (r.ok) { enriched += r.email ? 1 : 0; credits += r.credits; } else errors.push(r.error);
        if (!r.ok && r.stop) break;
      }
    }
    await audit(db, { actor: user.email, action: "apollo_save", entity: "contacts", after: { saved, enriched, credits } });
    notice = `Saved ${saved} ${saved === 1 ? "person" : "people"}${enrich ? `, ${enriched} emails found (${credits} credits)` : ""}.${errors.length ? ` ${errors[0]}` : ""}`;
  });
  redirect(withNotice(back, notice));
}

const enrichApollo = (db: ReturnType<typeof appDb>, _mandateId: string, contactId: string) => enrichContactWithApollo(db, apolloConfig(), contactId);

// ---------- Bulk actions on saved records ----------
export async function bulkEnrichPeople(formData: FormData) {
  const chosen = ids(formData);
  const back = safeBack(formData.get("back"), "/people");
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const rows = await db.select({ id: contacts.id, mandateId: contacts.mandateId }).from(contacts).where(and(inArray(contacts.id, chosen), mandateCondition(user.scope, contacts.mandateId)));
    let found = 0, credits = 0;
    for (const r of rows) {
      const res = await enrichApollo(db, r.mandateId, r.id);
      if (!res.ok) { notice = res.error; if (res.stop) break; continue; }
      found += res.email ? 1 : 0; credits += res.credits;
    }
    await audit(db, { actor: user.email, action: "apollo_enrich", entity: "contacts", after: { count: rows.length, found, credits } });
    notice = notice || `Enrichment done: ${found} of ${rows.length} emails found, ${credits} Apollo credits used.`;
  });
  redirect(withNotice(back, notice));
}

export async function bulkPublicEnrich(formData: FormData) {
  const chosen = ids(formData);
  const back = safeBack(formData.get("back"), "/companies");
  await withOsUser(async user => {
    const db = appDb();
    const rows = await db.select({ id: organizations.id }).from(organizations).where(and(inArray(organizations.id, chosen), mandateCondition(user.scope, organizations.mandateId)));
    for (const r of rows) await enqueue(db, "identity.enrich", { orgId: r.id }, { dedupeKey: `identity:${r.id}:${new Date().toISOString().slice(0, 13)}` });
    await audit(db, { actor: user.email, action: "public_enrich_queued", entity: "organizations", after: { count: rows.length } });
  });
  redirect(withNotice(back, `Queued free public-source enrichment (Wikidata, GLEIF, SEC) for ${chosen.length} organizations.`));
}

export async function bulkResearch(formData: FormData) {
  const chosen = ids(formData);
  const kind = z.enum(["people", "companies"]).parse(formData.get("kind"));
  const depth = z.enum(["full", "light"]).catch("full").parse(formData.get("depth"));
  const back = safeBack(formData.get("back"), `/${kind}`);
  await withOsUser(async user => {
    const db = appDb();
    let orgIds: { orgId: string | null; contactId: string | null }[];
    if (kind === "companies") {
      orgIds = (await db.select({ id: organizations.id }).from(organizations).where(and(inArray(organizations.id, chosen), mandateCondition(user.scope, organizations.mandateId)))).map(o => ({ orgId: o.id, contactId: null }));
    } else {
      orgIds = (await db.select({ orgId: contacts.orgId, id: contacts.id }).from(contacts).where(and(inArray(contacts.id, chosen), mandateCondition(user.scope, contacts.mandateId)))).map(c => ({ orgId: c.orgId, contactId: c.id }));
    }
    const seen = new Set<string>();
    for (const o of orgIds) {
      if (!o.orgId || seen.has(o.orgId)) continue;
      seen.add(o.orgId);
      await requestResearch(db, o.orgId, depth, o.contactId);
    }
    await audit(db, { actor: user.email, action: "research_requested", entity: kind, after: { count: seen.size, depth } });
  });
  redirect(withNotice(back, `Research queued for ${chosen.length} ${kind === "people" ? "people" : "organizations"} (${depth}). Dossiers appear on each record when ready.`));
}

export async function addToList(formData: FormData) {
  const chosen = ids(formData);
  const kind = z.enum(["people", "companies"]).parse(formData.get("kind"));
  const listId = z.string().uuid().optional().catch(undefined).parse(formData.get("listId") || undefined);
  const newName = z.string().trim().max(120).optional().parse((formData.get("newList") as string) || undefined);
  const back = safeBack(formData.get("back"), `/${kind}`);
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const mandateId = user.scope.ownerOf[0] ?? user.scope.mandateIds[0];
    let target = listId;
    if (!target && newName) {
      const [l] = await db.insert(lists).values({ mandateId, name: newName, kind, createdBy: user.email }).onConflictDoUpdate({ target: [lists.mandateId, lists.kind, lists.name], set: { updatedAt: new Date().toISOString() } }).returning();
      target = l.id;
    }
    if (!target) { notice = "Choose a list or name a new one."; return; }
    const [l] = await db.select().from(lists).where(and(eq(lists.id, target), mandateCondition(user.scope, lists.mandateId)));
    if (!l) throw new Error("List not found");
    for (const id of chosen) await db.insert(listMembers).values({ listId: target, entityId: id }).onConflictDoNothing();
    await audit(db, { actor: user.email, action: "list_add", entity: "lists", entityId: target, after: { count: chosen.length } });
    notice = `Added ${chosen.length} to "${l.name}".`;
  });
  redirect(withNotice(back, notice));
}

export async function createList(formData: FormData) {
  const name = z.string().trim().min(1).max(120).parse(formData.get("name"));
  const kind = z.enum(["people", "companies"]).parse(formData.get("kind"));
  await withOsUser(async user => {
    const db = appDb();
    await db.insert(lists).values({ mandateId: user.scope.ownerOf[0] ?? user.scope.mandateIds[0], name, kind, createdBy: user.email }).onConflictDoNothing();
    await audit(db, { actor: user.email, action: "list_create", entity: "lists", after: { name, kind } });
  });
  redirect("/lists");
}

export async function deleteList(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  await withOsUser(async user => {
    const db = appDb();
    const [l] = await db.select().from(lists).where(and(eq(lists.id, id), mandateCondition(user.scope, lists.mandateId)));
    if (!l) throw new Error("List not found");
    await db.delete(listMembers).where(eq(listMembers.listId, id));
    await db.delete(lists).where(eq(lists.id, id));
    await audit(db, { actor: user.email, action: "list_delete", entity: "lists", entityId: id, before: { name: l.name } });
  });
  redirect("/lists");
}

// ---------- Manual entry and record actions ----------
export async function addOrganization(formData: FormData) {
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  const website = z.string().trim().max(300).optional().parse((formData.get("website") as string) || undefined);
  const location = z.string().trim().max(200).optional().parse((formData.get("location") as string) || undefined);
  let id = "";
  await withOsUser(async user => {
    const db = appDb();
    const r = await upsertOrganization(db, user.scope.ownerOf[0] ?? user.scope.mandateIds[0], { name, website, location }, "other", { source: "manual" });
    id = r.row.id;
    await enqueue(db, "identity.enrich", { orgId: id }, { dedupeKey: `identity:${id}` });
    await audit(db, { actor: user.email, action: "org_add", entity: "organizations", entityId: id });
  });
  redirect(`/companies/${id}`);
}

export async function addPerson(formData: FormData) {
  const fullName = z.string().trim().min(2).max(160).parse(formData.get("fullName"));
  const email = z.string().trim().email().max(180).optional().catch(undefined).parse((formData.get("email") as string) || undefined);
  const title = z.string().trim().max(160).optional().parse((formData.get("title") as string) || undefined);
  const orgName = z.string().trim().max(200).optional().parse((formData.get("org") as string) || undefined);
  let id = "";
  await withOsUser(async user => {
    const db = appDb();
    const mandateId = user.scope.ownerOf[0] ?? user.scope.mandateIds[0];
    let orgId: string | null = null;
    if (orgName) orgId = (await upsertOrganization(db, mandateId, { name: orgName, domain: email?.split("@")[1], domainInferred: true }, "other", { source: "manual" })).row.id;
    const c = await upsertContact(db, mandateId, { fullName, email, title, orgId, emailStatus: email ? "unverified" : undefined }, "other", { source: "manual" });
    id = c.row.id;
    await audit(db, { actor: user.email, action: "person_add", entity: "contacts", entityId: id });
  });
  redirect(`/people/${id}`);
}

export async function pasteLinkedin(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const text = z.string().trim().max(20000).parse(formData.get("text"));
  await withOsUser(async user => {
    const db = appDb();
    const [c] = await db.select().from(contacts).where(and(eq(contacts.id, id), mandateCondition(user.scope, contacts.mandateId)));
    if (!c) throw new Error("Contact not found");
    await db.update(contacts).set({ linkedinProfileText: text, updatedAt: new Date().toISOString() }).where(eq(contacts.id, id));
    await db.insert(activities).values({ mandateId: c.mandateId, contactId: id, orgId: c.orgId, type: "linkedin", detail: "LinkedIn profile text pasted", source: "manual", actor: user.email });
  });
  redirect(`/people/${id}?notice=${encodeURIComponent("LinkedIn profile saved. It is used in the next research run.")}`);
}

export async function addNote(formData: FormData) {
  const entity = z.enum(["contact", "organization"]).parse(formData.get("entity"));
  const id = z.string().uuid().parse(formData.get("id"));
  const text = z.string().trim().min(1).max(5000).parse(formData.get("text"));
  await withOsUser(async user => {
    const db = appDb();
    const table = entity === "contact" ? contacts : organizations;
    const [row] = await db.select({ mandateId: table.mandateId }).from(table).where(and(eq(table.id, id), mandateCondition(user.scope, table.mandateId)));
    if (!row) throw new Error("Record not found");
    await db.insert(activities).values({ mandateId: row.mandateId, contactId: entity === "contact" ? id : null, orgId: entity === "organization" ? id : null, type: "note", detail: text, source: "manual", actor: user.email });
  });
  redirect(entity === "contact" ? `/people/${id}` : `/companies/${id}`);
}

const zApolloOrgPick = z.object({
  id: z.string().nullish(), name: z.string().nullish(), domain: z.string().nullish(), website: z.string().nullish(), industry: z.string().nullish(),
  headcount: z.number().nullish(), city: z.string().nullish(), country: z.string().nullish(), linkedin_url: z.string().nullish(),
  founded: z.number().nullish(), description: z.string().nullish(),
});

export async function saveApolloCompanies(formData: FormData) {
  const picks = formData.getAll("pick").map(v => zApolloOrgPick.parse(JSON.parse(String(v)))).filter(p => p.name);
  const back = safeBack(formData.get("back"), "/companies?tab=apollo");
  if (picks.length === 0) redirect(withNotice(back, "Select at least one company."));
  await withOsUser(async user => {
    const db = appDb();
    const mandateId = user.scope.ownerOf[0] ?? user.scope.mandateIds[0];
    for (const p of picks) {
      const o = await upsertOrganization(db, mandateId, {
        name: p.name!, domain: p.domain, website: p.website, industry: p.industry, headcount: p.headcount ?? null, foundedYear: p.founded ?? null,
        description: p.description, location: [p.city, p.country].filter(Boolean).join(", ") || null, apolloOrgId: p.id ?? null, linkedinUrl: p.linkedin_url,
      }, "apollo", { source: "apollo" });
      if (o.created) await enqueue(db, "identity.enrich", { orgId: o.row.id }, { dedupeKey: `identity:${o.row.id}` });
    }
    await audit(db, { actor: user.email, action: "apollo_save_companies", entity: "organizations", after: { count: picks.length } });
  });
  redirect(withNotice(back, `Saved ${picks.length} companies. Free identity enrichment and map placement are queued.`));
}

export async function researchOne(formData: FormData) {
  const orgId = z.string().uuid().parse(formData.get("orgId"));
  const contactId = z.string().uuid().optional().catch(undefined).parse(formData.get("contactId") || undefined);
  const depth = z.enum(["full", "light"]).catch("full").parse(formData.get("depth"));
  const back = safeBack(formData.get("back"), `/companies/${orgId}`);
  await withOsUser(async user => {
    const db = appDb();
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, orgId), mandateCondition(user.scope, organizations.mandateId)));
    if (!o) throw new Error("Organization not found");
    await requestResearch(db, orgId, depth, contactId ?? null);
    await audit(db, { actor: user.email, action: "research_requested", entity: "organizations", entityId: orgId, after: { depth } });
  });
  redirect(withNotice(back, "Research queued. The dossier fills in on this page when ready."));
}

export async function publicEnrichOne(formData: FormData) {
  const orgId = z.string().uuid().parse(formData.get("orgId"));
  await withOsUser(async user => {
    const db = appDb();
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, orgId), mandateCondition(user.scope, organizations.mandateId)));
    if (!o) throw new Error("Organization not found");
    await enqueue(db, "identity.enrich", { orgId }, { dedupeKey: `identity:${orgId}:${new Date().toISOString().slice(0, 13)}` });
  });
  redirect(withNotice(`/companies/${orgId}`, "Public-source enrichment queued (Wikidata, GLEIF, SEC, map location)."));
}

const COMPOSE_REASON: Record<string, string> = {
  not_found: "Contact not found.",
  no_email: "This person has no email address yet. Enrich with Apollo or add one.",
  suppressed: "This address is suppressed (unsubscribed, bounced or blocked).",
  investment_mandate: "Investment-mandate contacts are manual, relationship-only: no email from the OS.",
  recipient_not_allowed: "Outside production, email can only go to SEND_ALLOWED_DOMAINS (your test inbox).",
  needs_confirmation: "The address is not verified. Tick the confirmation box to send anyway.",
  no_mailbox: "Connect the primary Gmail mailbox in Settings → Connections first.",
};

export async function sendEmail(formData: FormData) {
  const contactId = z.string().uuid().parse(formData.get("contactId"));
  const subject = z.string().trim().min(1).max(200).parse(formData.get("subject"));
  const body = z.string().trim().min(1).max(10000).parse(formData.get("body"));
  const confirmUnverified = formData.get("confirmUnverified") === "on";
  let notice = "";
  await withOsUser(async user => {
    const db = appDb();
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), mandateCondition(user.scope, contacts.mandateId)));
    if (!c) throw new Error("Contact not found");
    const policy = sendPolicy();
    const r = await composeManualEmail(db, { contactId, subject, body, approvedBy: user.email, confirmUnverified, policy });
    if (!r.ok) {
      notice = r.reason === "style" ? `Not sent. House style: ${(r.issues ?? []).map(i => i.detail).join(" ")}` : `Not sent. ${COMPOSE_REASON[r.reason]}`;
      return;
    }
    const cfg = googleConfig();
    if (!cfg) { notice = "Not sent. Google is not configured."; return; }
    if (!(await claimMessage(db, r.messageId))) { notice = "Not sent. The message was already claimed or the address was suppressed."; return; }
    const sent = await sendClaimedMessage(db, r.messageId, () => getAccessToken(db, cfg, "primary"), policy);
    await audit(db, { actor: user.email, action: sent.sent ? "email_sent" : "email_failed", entity: "messages", entityId: r.messageId });
    notice = sent.sent ? "Email sent from the primary mailbox." : `Send failed: ${sent.reason}`;
  });
  redirect(`/people/${contactId}?notice=${encodeURIComponent(notice)}`);
}

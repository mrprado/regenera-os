// regenera.bio intake (SPEC section 24): inquiries and Partner Network referrals via a signed webhook
// and an hourly reconcile, plus the one-time Pipeline Tracker import. Shapes mirror the site's D1 schema.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { activities, deals, partners, siteEvents } from "@/db/schema";
import { hmac, safeEqual } from "@/lib/crypto";
import { REGENERA_MANDATE_ID } from "@/lib/membership";
import { upsertContact, upsertOrganization } from "./entities";

// ---------- signatures ----------
export const SIGNATURE_WINDOW_MS = 5 * 60_000;

/** Header value: "t=<unix ms>,v1=<hmac(secret, 'site-webhook', `${t}.${body}`)>" */
export async function signSiteBody(secret: string, body: string, t = Date.now()): Promise<string> {
  return `t=${t},v1=${await hmac(secret, "site-webhook", `${t}.${body}`)}`;
}

export async function verifySiteSignature(secret: string | undefined, header: string | null, body: string, now = Date.now()): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > SIGNATURE_WINDOW_MS || !parts.v1) return false;
  return safeEqual(parts.v1, await hmac(secret, "site-webhook", `${t}.${body}`));
}

// ---------- payloads (site D1 rows) ----------
export const zInquiry = z.object({
  id: z.number().int(), kind: z.enum(["opportunity", "capital", "partnership"]), audienceType: z.string().default(""),
  name: z.string(), email: z.string(), organization: z.string().default(""), role: z.string().default(""),
  sector: z.string().default(""), geography: z.string().default(""), stage: z.string().default(""), ticket: z.string().default(""),
  structure: z.string().default(""), summary: z.string().default(""), createdAt: z.string(),
});
export const zReferral = z.object({
  id: z.number().int(), partnerName: z.string(), partnerEmail: z.string(), partnerOrg: z.string().default(""),
  type: z.enum(["capital", "opportunity"]), refName: z.string(), refOrg: z.string().default(""), sector: z.string().default(""),
  context: z.string().default(""), tier: z.enum(["standard", "strategic", "institutional"]), status: z.enum(["submitted", "scoped", "mandate_signed", "paid", "declined"]),
  date: z.string(), createdAt: z.string(),
});
export const zSiteEvent = z.discriminatedUnion("event", [
  z.object({ event: z.literal("inquiry.created"), data: zInquiry }),
  z.object({ event: z.literal("referral.created"), data: zReferral }),
  z.object({ event: z.literal("referral.updated"), data: zReferral }),
]);
export type SiteEvent = z.infer<typeof zSiteEvent>;

// The site's sector options map to OS sector keys.
const SITE_SECTOR: Record<string, string> = {
  "Energy": "energy", "Infrastructure": "infrastructure", "Land & Built Environment": "land_built_environment",
  "Waste & Resource Systems": "waste_resource_systems", "Water, Food & Nature": "water_food_nature",
};

/** Idempotent on (kind, site id): the webhook and the hourly reconcile can both deliver the same row. */
export async function applySiteEvent(db: Db, e: SiteEvent, mandateId = REGENERA_MANDATE_ID): Promise<{ dealId: string | null; created: boolean }> {
  const kind = e.event.startsWith("inquiry") ? "inquiry" : "referral";
  const [existing] = await db.select().from(siteEvents).where(and(eq(siteEvents.mandateId, mandateId), eq(siteEvents.kind, kind), eq(siteEvents.siteId, e.data.id)));

  if (e.event === "inquiry.created") {
    if (existing) return { dealId: existing.dealId, created: false };
    const i = e.data;
    const org = i.organization ? (await upsertOrganization(db, mandateId, { name: i.organization, domain: i.email.split("@")[1], location: i.geography || null, sector: SITE_SECTOR[i.sector] ?? null }, "website", { source: "site" })).row : null;
    const contact = (await upsertContact(db, mandateId, { fullName: i.name, email: i.email, title: i.role || null, orgId: org?.id ?? null, emailStatus: "unverified" }, "website", { source: "site" })).row;
    let dealId: string | null = null;
    if (i.kind !== "partnership") {
      const [deal] = await db.insert(deals).values({
        mandateId, orgId: org?.id ?? null, contactId: contact.id, name: `${i.organization || i.name}: ${i.kind === "capital" ? "capital mandate" : "project diagnostic"}`,
        path: i.kind === "capital" ? "capital_mandate" : "project_diagnostic", stage: "lead", engagement: i.kind === "capital" ? "capital_screening" : "diagnostic",
        sector: SITE_SECTOR[i.sector] ?? null, ticket: i.ticket || null, source: "website",
        notes: [i.summary, i.stage && `Stage: ${i.stage}`, i.structure && `Structure: ${i.structure}`, i.audienceType && `Audience: ${i.audienceType}`].filter(Boolean).join("\n"),
        nextAction: "Review inquiry and reply with the scoping-call link", nextActionDate: i.createdAt.slice(0, 10),
      }).returning();
      dealId = deal.id;
    } else {
      await db.insert(partners).values({ mandateId, orgId: org?.id ?? null, name: i.name, email: i.email.toLowerCase() }).onConflictDoNothing();
    }
    await db.insert(activities).values({ mandateId, contactId: contact.id, orgId: org?.id ?? null, dealId, type: "site_inquiry", detail: `regenera.bio inquiry (${i.kind}): ${i.summary.slice(0, 400)}`, occurredAt: new Date(i.createdAt.replace(" ", "T") + (i.createdAt.includes("Z") ? "" : "Z")).toISOString(), source: "site" });
    await db.insert(siteEvents).values({ mandateId, kind, siteId: i.id, payload: i, contactId: contact.id, dealId });
    return { dealId, created: true };
  }

  // Referrals: create on first sight, then track status and tier changes.
  const r = e.data;
  const partner = (await db.insert(partners).values({ mandateId, name: r.partnerName, email: r.partnerEmail.toLowerCase(), tier: r.tier, referralStatus: r.status })
    .onConflictDoUpdate({ target: [partners.mandateId, partners.email], set: { tier: r.tier, referralStatus: r.status, updatedAt: new Date().toISOString() } }).returning())[0];
  if (existing) {
    if (existing.dealId) {
      const stage = r.status === "mandate_signed" || r.status === "paid" ? "signed" : r.status === "declined" ? "lost" : r.status === "scoped" ? "proposal" : undefined;
      if (stage) await db.update(deals).set({ stage, stageChangedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(deals.id, existing.dealId));
    }
    await db.update(siteEvents).set({ payload: r, updatedAt: new Date().toISOString() }).where(eq(siteEvents.id, existing.id));
    await db.insert(activities).values({ mandateId, dealId: existing.dealId, contactId: existing.contactId, type: "referral", detail: `Referral status ${r.status} (tier ${r.tier}) from ${r.partnerName}`, source: "site" });
    return { dealId: existing.dealId, created: false };
  }
  const org = r.refOrg ? (await upsertOrganization(db, mandateId, { name: r.refOrg, sector: SITE_SECTOR[r.sector] ?? null }, "referral", { source: "site" })).row : null;
  const contact = (await upsertContact(db, mandateId, { fullName: r.refName, orgId: org?.id ?? null }, "referral", { source: "site" })).row;
  const [deal] = await db.insert(deals).values({
    mandateId, orgId: org?.id ?? null, contactId: contact.id, name: `${r.refOrg || r.refName}: referral from ${r.partnerName}`,
    path: r.type === "capital" ? "capital_mandate" : "project_diagnostic", stage: "lead", engagement: r.type === "capital" ? "capital_screening" : "diagnostic",
    source: "referral", sector: SITE_SECTOR[r.sector] ?? null, notes: `${r.context}\nPartner: ${r.partnerName} (${r.partnerOrg}), tier ${r.tier}. Conflict check before contact.`,
    nextAction: "Run conflict check, then contact via the partner", nextActionDate: r.date,
  }).returning();
  await db.insert(activities).values({ mandateId, contactId: contact.id, orgId: org?.id ?? null, dealId: deal.id, type: "referral", detail: `Partner Network referral from ${r.partnerName} (${partner.tier})`, source: "site" });
  await db.insert(siteEvents).values({ mandateId, kind, siteId: r.id, payload: r, contactId: contact.id, dealId: deal.id });
  return { dealId: deal.id, created: true };
}

// ---------- Pipeline Tracker import (site pipeline_entries + pipeline_contacts) ----------
export const zTrackerEntry = z.object({
  id: z.number().int(), inquiryId: z.number().int().nullish(), name: z.string(), organization: z.string().default(""), email: z.string().default(""),
  type: z.enum(["capital", "opportunity"]), engagement: z.string().default("diagnostic"), sector: z.string().default(""), source: z.string().default(""),
  fee: z.string().default("one_time"), ticket: z.string().default(""), monthly: z.string().default(""), equity: z.string().default(""),
  dealSize: z.string().default(""), percentage: z.string().default(""), flatFee: z.string().default(""), stage: z.string().default("lead"),
  notes: z.string().default(""), date: z.string(),
  contacts: z.array(z.object({ contactedAt: z.string(), method: z.string().default("email"), note: z.string().default("") })).default([]),
});
export type TrackerEntry = z.infer<typeof zTrackerEntry>;

const STAGE_MAP: Record<string, string> = { lead: "lead", call_booked: "call_booked", proposal: "proposal", signed: "signed", active: "active", renewed: "expansion", completed: "completed", churned: "churned", lost: "lost" };
const ENGAGEMENT_KEYS = ["diagnostic", "readiness_mandate", "development_office", "capital_advisory", "governance_monitoring", "capital_screening"];
const FEE_KEYS = ["one_time", "monthly_retainer", "milestone", "fee_plus_equity", "success_fee"];
const SOURCE_KEYS = ["website", "organic", "linkedin", "google", "referral", "email", "event", "other"];

export function mapTrackerEntry(e: TrackerEntry) {
  return {
    stage: (STAGE_MAP[e.stage] ?? "lead") as never,
    engagement: (ENGAGEMENT_KEYS.includes(e.engagement) ? e.engagement : "diagnostic") as never,
    feeType: (FEE_KEYS.includes(e.fee) ? e.fee : "one_time") as never,
    source: (SOURCE_KEYS.includes(e.source) ? e.source : "other") as never,
    path: (e.type === "capital" ? "capital_mandate" : "project_diagnostic") as "capital_mandate" | "project_diagnostic",
    feeTerms: Object.fromEntries(Object.entries({ monthly: e.monthly, equity: e.equity, dealSize: e.dealSize, percentage: e.percentage, flatFee: e.flatFee }).filter(([, v]) => v)),
  };
}

/** Re-runnable: keyed on legacy_pipeline_entry_id, so a second run updates instead of duplicating. */
export async function importTracker(db: Db, entries: TrackerEntry[], mandateId = REGENERA_MANDATE_ID) {
  const counts: Record<string, number> = {};
  let created = 0, updated = 0;
  for (const e of entries) {
    const m = mapTrackerEntry(e);
    counts[m.stage] = (counts[m.stage] ?? 0) + 1;
    const org = e.organization ? (await upsertOrganization(db, mandateId, { name: e.organization, domain: e.email.split("@")[1], sector: SITE_SECTOR[e.sector] ?? null }, m.source, { source: "tracker" })).row : null;
    const contact = (await upsertContact(db, mandateId, { fullName: e.name, email: e.email || null, orgId: org?.id ?? null, emailStatus: e.email ? "unverified" : undefined }, m.source, { source: "tracker" })).row;
    const values = {
      mandateId, orgId: org?.id ?? null, contactId: contact.id, name: e.organization ? `${e.organization}: ${e.name}` : e.name,
      path: m.path, stage: m.stage, engagement: m.engagement, feeType: m.feeType, feeTerms: m.feeTerms, sector: SITE_SECTOR[e.sector] ?? (e.sector || null),
      ticket: e.ticket || null, source: m.source, notes: e.notes, legacyPipelineEntryId: e.id,
    };
    const [existing] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.mandateId, mandateId), eq(deals.legacyPipelineEntryId, e.id)));
    let dealId: string;
    if (existing) {
      await db.update(deals).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(deals.id, existing.id));
      dealId = existing.id; updated++;
      await db.delete(activities).where(and(eq(activities.dealId, dealId), eq(activities.source, "import")));
    } else {
      dealId = (await db.insert(deals).values({ ...values, createdAt: `${e.date}T00:00:00.000Z` }).returning())[0].id; created++;
    }
    for (const c of e.contacts) {
      await db.insert(activities).values({ mandateId, contactId: contact.id, orgId: org?.id ?? null, dealId, type: "email", method: c.method, detail: c.note || `Contact by ${c.method} (tracker)`, occurredAt: new Date(c.contactedAt).toISOString(), source: "import" });
    }
  }
  return { created, updated, byStage: counts };
}

// ---------- pull from the site's export endpoint ----------
const zExport = <T extends z.ZodTypeAny>(row: T) => z.object({ rows: z.array(row) });

async function siteExport<T extends z.ZodTypeAny>(cfg: { baseUrl: string; token: string }, kind: string, row: T, since?: string, fetchImpl: typeof fetch = fetch): Promise<z.infer<T>[]> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/api/export/${kind}${since ? `?since=${encodeURIComponent(since)}` : ""}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`regenera.bio export ${kind} returned ${res.status}`);
  return zExport(row).parse(await res.json()).rows;
}

/** Hourly: applies any inquiries and referrals the webhook missed (idempotent on site ids). */
export async function reconcileSite(db: Db, cfg: { baseUrl: string; token: string }, sinceIso: string, fetchImpl?: typeof fetch) {
  const inq = await siteExport(cfg, "inquiries", zInquiry, sinceIso, fetchImpl);
  const refs = await siteExport(cfg, "referrals", zReferral, sinceIso, fetchImpl);
  let applied = 0;
  for (const i of inq) if ((await applySiteEvent(db, { event: "inquiry.created", data: i })).created) applied++;
  for (const r of refs) if ((await applySiteEvent(db, { event: "referral.updated", data: r })).created) applied++;
  return { inquiries: inq.length, referrals: refs.length, applied };
}

export async function importTrackerFromSite(db: Db, cfg: { baseUrl: string; token: string }, fetchImpl?: typeof fetch) {
  const rows = await siteExport(cfg, "pipeline", zTrackerEntry, undefined, fetchImpl);
  return importTracker(db, rows);
}

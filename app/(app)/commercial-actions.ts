"use server";

// Commercial operations: services and pricing, engagements, invoices, expenses, time, partners, accounts, entities.
// Nothing is emailed or charged from here: "sent" records that the invoice left through the billing system.
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { accountConnections, commercialPartners, corporateEntities, engagements, expenses, invoices, services, timeEntries } from "@/db/schema";
import type { Deliverable, PaymentLine } from "@/db/commercial";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { changeOrder, createEngagement, engagementConflicts, invoiceFromSchedule, recordPayment, setEngagementStatus } from "@/lib/commercial/engine";
import { ACCOUNT_CATEGORIES, ACCOUNT_STATUSES, BILLING_TYPES, CHANGE_REASONS, DELIVERABLE_STATUSES, ENGAGEMENT_STATUSES, ENTITY_KINDS, EXPENSE_CATEGORIES, EXPENSE_CLASSES, PARTNER_KINDS } from "@/lib/commercial/vocab";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (f: FormData, k: string) => { const v = str(f, k).replace(/[^0-9.\-]/g, ""); const n = Number(v); return v && Number.isFinite(n) ? n : null; };
const date = (f: FormData, k: string) => zDate.safeParse(f.get(k)).data ?? null;
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const eUrl = (id: string) => `/commercial/engagements/${id}`;

async function scopedEngagement(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [e] = await appDb().select().from(engagements).where(and(eq(engagements.id, id), mandateCondition(scope, engagements.mandateId)));
  if (!e) throw new Error("Engagement not found");
  return e;
}

export async function createEngagementAction(formData: FormData) {
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  const serviceIds = formData.getAll("serviceId").map(v => zId.parse(v));
  let id = "";
  await withOsUser(async user => {
    const mandateId = user.scope.mandateIds[0];
    id = (await createEngagement(appDb(), { mandateId, name, serviceIds, orgId: zId.safeParse(formData.get("orgId")).data ?? null, projectId: zId.safeParse(formData.get("projectId")).data ?? null, dealId: zId.safeParse(formData.get("dealId")).data ?? null, source: str(formData, "source", 60), months: num(formData, "months") ?? undefined }, user.email)).id;
  });
  redirect(note(eUrl(id), "Engagement created from the selected services: deliverables and a default payment schedule are drafted for you to edit."));
}

export async function updateEngagementAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await scopedEngagement(user.scope, id);
    await appDb().update(engagements).set({
      name: z.string().trim().min(2).max(200).parse(formData.get("name")), scope: str(formData, "scope", 5000), assumptions: str(formData, "assumptions", 3000), exclusions: str(formData, "exclusions", 3000),
      clientResponsibilities: str(formData, "clientResponsibilities", 3000), fee: num(formData, "fee") ?? 0, monthlyFee: num(formData, "monthlyFee") ?? 0, months: Math.round(num(formData, "months") ?? 0),
      currency: z.string().regex(/^[A-Z]{3}$/).catch("USD").parse(str(formData, "currency").toUpperCase()), paymentTerms: str(formData, "paymentTerms", 120) || "Net 30",
      billingType: z.enum(keys(BILLING_TYPES)).catch("fixed").parse(formData.get("billingType")), hourlyCost: num(formData, "hourlyCost"), probabilityPct: num(formData, "probabilityPct"),
      expectedHours: num(formData, "expectedHours") ?? 0, startDate: date(formData, "startDate"), endDate: date(formData, "endDate"), owner: str(formData, "owner", 120) || null, updatedAt: new Date().toISOString(),
    }).where(eq(engagements.id, id));
    await audit(appDb(), { actor: user.email, action: "engagement_update", entity: "engagements", entityId: id });
  });
  redirect(note(eUrl(id), "Engagement updated."));
}

export async function scheduleAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const lines = z.array(z.object({ id: z.string(), label: z.string().max(120), amount: z.number().min(0), due: zDate.nullable(), invoiceId: z.string().nullable().optional() })).max(60).parse(JSON.parse(String(formData.get("schedule") ?? "[]")));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    const locked = new Map(e.paymentSchedule.filter(l => l.invoiceId).map(l => [l.id, l]));
    const next: PaymentLine[] = [...locked.values(), ...lines.filter(l => !locked.has(l.id))];
    await appDb().update(engagements).set({ paymentSchedule: next, updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
  });
  redirect(note(eUrl(id), "Payment schedule saved (invoiced lines are unchanged)."));
}

export async function statusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const status = z.enum(keys(ENGAGEMENT_STATUSES)).parse(formData.get("status"));
  let msg = `Status: ${ENGAGEMENT_STATUSES[status]}.`;
  await withOsUser(async user => {
    await scopedEngagement(user.scope, id);
    try { await setEngagementStatus(appDb(), id, status, user.email, { lostReason: str(formData, "lostReason", 300) }); } catch (e) { msg = `Not changed: ${(e as Error).message}`; }
  });
  redirect(note(eUrl(id), msg));
}

export async function conflictCheckAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "";
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    const r = await engagementConflicts(appDb(), e);
    const decision = str(formData, "conflictNote", 1000);
    await appDb().update(engagements).set({ conflictStatus: r.status, conflictNote: decision || r.issues.map(i => i.detail).join("; "), updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
    await audit(appDb(), { actor: user.email, action: "engagement_conflict_check", entity: "engagements", entityId: id, after: r });
    msg = r.status === "clear" ? "Conflict check: CLEAR." : `Conflict check: ${r.status.toUpperCase()}: ${r.issues.map(i => i.detail).join("; ")}. Record the decision before contracting.`;
  });
  redirect(note(eUrl(id), msg));
}

export async function conflictDecisionAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    if (!isOwner(user.scope, e.mandateId)) throw new Error("Only an owner records a conflict decision");
    const decision = z.string().trim().min(5).max(1000).parse(formData.get("conflictNote"));
    await appDb().update(engagements).set({ conflictNote: decision, conflictStatus: e.conflictStatus === "conflict" && formData.get("clear") === "on" ? "review" : e.conflictStatus, updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
    await audit(appDb(), { actor: user.email, action: "engagement_conflict_decision", entity: "engagements", entityId: id, after: { decision } });
  });
  redirect(note(eUrl(id), "Conflict decision recorded."));
}

export async function approveEngagementAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    if (!isOwner(user.scope, e.mandateId)) throw new Error("Only an owner approves");
    await appDb().update(engagements).set({ approvedBy: user.email, updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
    await audit(appDb(), { actor: user.email, action: "engagement_approve", entity: "engagements", entityId: id });
  });
  redirect(note(eUrl(id), "Internal approval recorded."));
}

export async function deliverableAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    const did = str(formData, "deliverableId", 40);
    let list: Deliverable[] = e.deliverables;
    if (did) list = list.map(d => (d.id === did ? { ...d, status: z.enum(keys(DELIVERABLE_STATUSES)).parse(formData.get("status")), due: date(formData, "due") ?? d.due } : d));
    else list = [...list, { id: crypto.randomUUID().slice(0, 8), label: z.string().trim().min(2).max(200).parse(formData.get("label")), status: "not_started", due: date(formData, "due") }];
    await appDb().update(engagements).set({ deliverables: list, updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
  });
  redirect(eUrl(id));
}

export async function changeOrderAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    const co = str(formData, "coId", 40);
    let list = e.changeOrders;
    if (co) {
      if (!isOwner(user.scope, e.mandateId)) throw new Error("Only an owner decides change orders");
      const decision = z.enum(["approved", "rejected"]).parse(formData.get("decision"));
      list = list.map(c => (c.id === co ? { ...c, status: decision, approvedBy: user.email } : c));
    } else list = changeOrder(e, { reason: z.enum(keys(CHANGE_REASONS)).parse(formData.get("reason")), description: str(formData, "description", 1000), fee: num(formData, "fee") ?? 0, weeks: num(formData, "weeks") ?? 0 });
    await appDb().update(engagements).set({ changeOrders: list, updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
    await audit(appDb(), { actor: user.email, action: "engagement_change_order", entity: "engagements", entityId: id, after: { co: co || "new" } });
  });
  redirect(note(eUrl(id), "Change order updated."));
}

export async function invoiceAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "";
  await withOsUser(async user => {
    await scopedEngagement(user.scope, id);
    const op = z.enum(["create", "send", "pay", "void"]).parse(formData.get("op"));
    const invoiceId = zId.safeParse(formData.get("invoiceId")).data;
    try {
      if (op === "create") { const inv = await invoiceFromSchedule(appDb(), id, str(formData, "lineId", 40), date(formData, "issueDate") ?? new Date().toISOString().slice(0, 10), Math.round(num(formData, "termsDays") ?? 30), user.email); msg = `Invoice ${inv.number} drafted.`; }
      else if (op === "send" && invoiceId) { await appDb().update(invoices).set({ status: "sent", updatedAt: new Date().toISOString() }).where(and(eq(invoices.id, invoiceId), eq(invoices.engagementId, id))); await audit(appDb(), { actor: user.email, action: "invoice_sent", entity: "invoices", entityId: invoiceId }); msg = "Marked as sent (send it through your billing system; the OS does not email invoices)."; }
      else if (op === "pay" && invoiceId) { await recordPayment(appDb(), invoiceId, num(formData, "amount") ?? 0, date(formData, "paidAt") ?? new Date().toISOString().slice(0, 10), user.email); msg = "Payment recorded."; }
      else if (op === "void" && invoiceId) { await appDb().update(invoices).set({ status: "void", updatedAt: new Date().toISOString() }).where(and(eq(invoices.id, invoiceId), eq(invoices.engagementId, id))); await audit(appDb(), { actor: user.email, action: "invoice_void", entity: "invoices", entityId: invoiceId }); msg = "Invoice voided."; }
    } catch (e) { msg = `Not done: ${(e as Error).message}`; }
  });
  redirect(note(eUrl(id), msg));
}

export async function expenseAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    await appDb().insert(expenses).values({ mandateId: e.mandateId, engagementId: id, category: z.enum(keys(EXPENSE_CATEGORIES)).parse(formData.get("category")), classification: z.enum(keys(EXPENSE_CLASSES)).parse(formData.get("classification")),
      amount: z.number().positive().parse(num(formData, "amount")), currency: e.currency, date: date(formData, "date") ?? new Date().toISOString().slice(0, 10), vendor: str(formData, "vendor", 120), receiptUrl: z.string().url().safeParse(formData.get("receiptUrl")).data ?? null, note: str(formData, "note", 300), createdBy: user.email });
  });
  redirect(note(eUrl(id), "Expense recorded."));
}

export async function timeAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    await appDb().insert(timeEntries).values({ mandateId: e.mandateId, engagementId: id, person: str(formData, "person", 120) || user.email, workstream: str(formData, "workstream", 80), hours: z.number().positive().max(24 * 31).parse(num(formData, "hours")), date: date(formData, "date") ?? new Date().toISOString().slice(0, 10), note: str(formData, "note", 300) });
  });
  redirect(note(eUrl(id), "Time recorded (internal only)."));
}

export async function partnerLineAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const e = await scopedEngagement(user.scope, id);
    await appDb().update(engagements).set({ partners: [...e.partners, { name: z.string().trim().min(2).max(160).parse(formData.get("name")), role: str(formData, "role", 120), cost: num(formData, "cost") ?? 0, share: str(formData, "share", 60) }], updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
  });
  redirect(note(eUrl(id), "Partner added to the engagement economics."));
}

export async function updateServiceAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    const [s] = await appDb().select().from(services).where(and(eq(services.id, id), mandateCondition(user.scope, services.mandateId)));
    if (!s) throw new Error("Service not found");
    await appDb().update(services).set({ listPrice: num(formData, "listPrice"), minPrice: num(formData, "minPrice"), targetMarginPct: num(formData, "targetMarginPct") ?? s.targetMarginPct, expectedHours: num(formData, "expectedHours") ?? s.expectedHours, expectedExternalCost: num(formData, "expectedExternalCost") ?? s.expectedExternalCost, active: formData.get("active") === "on", updatedAt: new Date().toISOString() }).where(eq(services.id, id));
    await audit(appDb(), { actor: user.email, action: "service_pricing", entity: "services", entityId: id, before: { listPrice: s.listPrice, minPrice: s.minPrice }, after: { listPrice: num(formData, "listPrice"), minPrice: num(formData, "minPrice") } });
  });
  redirect(note("/commercial?tab=services", "Service pricing updated (policy change recorded in the audit log)."));
}

export async function addPartnerAction(formData: FormData) {
  await withOsUser(async user => {
    await appDb().insert(commercialPartners).values({ mandateId: user.scope.mandateIds[0], name: z.string().trim().min(2).max(160).parse(formData.get("name")), kind: z.enum(keys(PARTNER_KINDS)).parse(formData.get("kind")),
      capabilities: formData.getAll("capability").map(String).slice(0, 20), geographies: str(formData, "geographies", 300).split(",").map(s => s.trim()).filter(Boolean), rates: str(formData, "rates", 300), paymentTerms: str(formData, "paymentTerms", 120), commercialTerms: str(formData, "commercialTerms", 500), insuranceExpiry: date(formData, "insuranceExpiry"), notes: str(formData, "notes", 1000) });
  });
  redirect(note("/commercial?tab=partners", "Partner / vendor added."));
}

export async function addAccountAction(formData: FormData) {
  await withOsUser(async user => {
    await appDb().insert(accountConnections).values({ mandateId: user.scope.mandateIds[0], category: z.enum(keys(ACCOUNT_CATEGORIES)).parse(formData.get("category")), provider: z.string().trim().min(2).max(120).parse(formData.get("provider")),
      status: z.enum(keys(ACCOUNT_STATUSES)).parse(formData.get("status")), accountOwner: str(formData, "accountOwner", 120) || null, entity: str(formData, "entity", 120) || null, environment: formData.get("environment") === "sandbox" ? "sandbox" : "production",
      plan: str(formData, "plan", 120), monthlyCost: num(formData, "monthlyCost"), annualCost: num(formData, "annualCost"), renewalDate: date(formData, "renewalDate"), purpose: str(formData, "purpose", 300), costAllocation: (["overhead", "project", "engagement"] as const).find(v => v === formData.get("costAllocation")) ?? "overhead", adminContact: str(formData, "adminContact", 120) || null });
  });
  redirect(note("/commercial?tab=accounts", "Account recorded. Credentials never go here: use the provider's OAuth or Worker secrets."));
}

export async function addEntityAction(formData: FormData) {
  await withOsUser(async user => {
    await appDb().insert(corporateEntities).values({ mandateId: user.scope.mandateIds[0], name: z.string().trim().min(2).max(160).parse(formData.get("name")), kind: z.enum(keys(ENTITY_KINDS)).parse(formData.get("kind")), jurisdiction: str(formData, "jurisdiction", 120), formationDate: date(formData, "formationDate"), ownership: str(formData, "ownership", 300), registeredAgent: str(formData, "registeredAgent", 160), taxRegistration: str(formData, "taxRegistration", 120), annualFilingDue: date(formData, "annualFilingDue"), notes: str(formData, "notes", 1000) });
  });
  redirect(note("/commercial?tab=entities", "Entity recorded."));
}

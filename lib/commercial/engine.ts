// Commercial operations engine: catalogue seeding, pricing with visible calculation lines, engagements (scope,
// deliverables, payment schedule, change orders, status gates, conflict check), invoices (numbering, derived status,
// payments), engagement economics and profitability, and Command items. Regenera advisory economics only.
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { engagements, expenses, invoices, organizations, projectParties, services, timeEntries } from "@/db/schema";
import type { ChangeOrder, Deliverable, PaymentLine } from "@/db/commercial";
import { audit } from "@/lib/audit";
import { SERVICE_SEEDS } from "./catalog";
import { STAGE_PROBABILITY, type ENGAGEMENT_STATUSES } from "./vocab";

type Status = keyof typeof ENGAGEMENT_STATUSES;
type Service = typeof services.$inferSelect;
type Engagement = typeof engagements.$inferSelect;
const uid = () => crypto.randomUUID().slice(0, 8);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Seeds the catalogue once per entity; existing (possibly edited) services are left alone. */
export async function ensureServices(db: Db, mandateId: string) {
  const have = new Set((await db.select({ key: services.key, depth: services.depth }).from(services).where(eq(services.mandateId, mandateId))).map(s => `${s.key}:${s.depth}`));
  let added = 0;
  for (const s of SERVICE_SEEDS) {
    if (have.has(`${s.key}:${s.depth}`)) continue;
    await db.insert(services).values({
      mandateId, key: s.key, family: s.family, name: s.name, depth: s.depth, description: s.description, idealClient: s.idealClient, stages: s.stages, inputs: s.inputs, deliverables: s.deliverables,
      workflow: s.workflow, specialistRequired: s.specialistRequired, nextServices: s.next, timelineWeeks: s.timelineWeeks, billingType: s.billingType, bandLow: s.bandLow, bandHigh: s.bandHigh,
      minPrice: s.bandLow, listPrice: s.listPrice ?? (s.bandHigh !== null ? Math.round((s.bandLow + s.bandHigh) / 2 / 500) * 500 : s.bandLow), perMonth: s.perMonth, expectedHours: s.expectedHours,
      targetMarginPct: s.targetMarginPct, role: s.role, phase: s.phase, approvalRequired: s.approvalRequired, legalNotes: s.legalNotes, portalAccess: s.portalAccess, seeded: true,
    });
    added++;
  }
  return added;
}

export type PriceFactors = { complexity: "low" | "standard" | "high"; urgency: boolean; travelCost: number; specialistCost: number; hourlyCost: number | null; months?: number };
const COMPLEXITY = { low: 0.85, standard: 1, high: 1.3 };

/** Pricing recommendation with every step shown; never auto-applied, always editable. */
export function priceService(s: Pick<Service, "listPrice" | "minPrice" | "bandLow" | "bandHigh" | "expectedHours" | "expectedExternalCost" | "targetMarginPct" | "perMonth">, f: PriceFactors) {
  const lines: [string, string][] = [];
  const base = s.listPrice ?? s.bandLow ?? 0;
  lines.push(["List price (internal default)", `${base}`]);
  let suggested = base * COMPLEXITY[f.complexity];
  if (f.complexity !== "standard") lines.push([`Complexity ${f.complexity}`, `× ${COMPLEXITY[f.complexity]}`]);
  if (f.urgency) { suggested *= 1.15; lines.push(["Urgent timeline", "× 1.15"]); }
  const internal = f.hourlyCost ? s.expectedHours * f.hourlyCost : 0;
  const external = s.expectedExternalCost + f.specialistCost + f.travelCost;
  const expectedCost = internal + external;
  if (f.hourlyCost) lines.push(["Internal cost", `${s.expectedHours} h × ${f.hourlyCost} = ${r2(internal)}`]); else lines.push(["Internal cost", "no cost rate set: margin excludes internal time"]);
  if (external) lines.push(["External cost", `${r2(external)} (specialists, travel, pass-through excluded)`]);
  // Price floor that meets the target margin on known costs.
  const marginFloor = expectedCost > 0 ? expectedCost / (1 - s.targetMarginPct / 100) : 0;
  if (marginFloor > suggested) { lines.push([`Raised to meet ${s.targetMarginPct}% target margin`, `${r2(marginFloor)}`]); suggested = marginFloor; }
  const minimum = Math.max(s.minPrice ?? 0, expectedCost);
  suggested = Math.round(suggested / 500) * 500;
  const margin = suggested > 0 ? ((suggested - expectedCost) / suggested) * 100 : null;
  return { list: base, suggested, minimum, expectedCost: r2(expectedCost), expectedMarginPct: margin === null ? null : r2(margin), lowMargin: margin !== null && margin < s.targetMarginPct - 5, perMonth: s.perMonth, lines };
}

export async function createEngagement(db: Db, input: { mandateId: string; name: string; orgId?: string | null; projectId?: string | null; dealId?: string | null; serviceIds: string[]; fee?: number | null; monthlyFee?: number | null; months?: number; currency?: string; source?: string; owner?: string | null }, actor: string) {
  const svc = input.serviceIds.length ? await db.select().from(services).where(and(eq(services.mandateId, input.mandateId), inArray(services.id, input.serviceIds))) : [];
  const deliverables: Deliverable[] = svc.flatMap(s => s.deliverables.map(label => ({ id: uid(), label, status: "not_started", due: null, serviceKey: s.key })));
  const oneOff = svc.filter(s => !s.perMonth), monthly = svc.filter(s => s.perMonth);
  const fee = input.fee ?? oneOff.reduce((a, s) => a + (s.listPrice ?? 0), 0);
  const monthlyFee = input.monthlyFee ?? monthly.reduce((a, s) => a + (s.listPrice ?? 0), 0);
  const months = input.months ?? (monthly.length ? 6 : 0);
  // Default schedule: 50 % on signature, 50 % on delivery for fixed work; retainer invoiced monthly.
  const schedule: PaymentLine[] = [];
  if (fee > 0) schedule.push({ id: uid(), label: "Deposit on signature (50%)", amount: r2(fee / 2), due: null }, { id: uid(), label: "Balance on delivery (50%)", amount: r2(fee / 2), due: null });
  for (let m = 1; m <= months; m++) if (monthlyFee > 0) schedule.push({ id: uid(), label: `Retainer month ${m}`, amount: monthlyFee, due: null });
  const [row] = await db.insert(engagements).values({
    mandateId: input.mandateId, name: input.name, orgId: input.orgId ?? null, projectId: input.projectId ?? null, dealId: input.dealId ?? null, source: input.source ?? "", owner: input.owner ?? actor,
    workstreams: svc.map(s => s.key), deliverables, paymentSchedule: schedule, fee, monthlyFee, months, currency: input.currency ?? svc[0]?.currency ?? "USD",
    billingType: monthly.length && oneOff.length ? "hybrid" : monthly.length ? "monthly_retainer" : "fixed",
    expectedHours: svc.reduce((a, s) => a + s.expectedHours * (s.perMonth ? Math.max(1, months) : 1), 0), expectedExternalCost: svc.reduce((a, s) => a + s.expectedExternalCost, 0),
    approvalRequired: svc.some(s => s.approvalRequired), nextService: svc.flatMap(s => s.nextServices)[0] ?? null,
    scope: svc.map(s => `${s.name}${s.depth !== "standard" ? ` (${s.depth})` : ""}: ${s.description || s.deliverables.join(", ")}`).join("\n"),
  }).returning();
  await audit(db, { actor, action: "engagement_create", entity: "engagements", entityId: row.id, after: { name: input.name, services: svc.map(s => s.key), fee, monthlyFee } });
  return row;
}

/** Conflict check before engagement: other clients on the same project; client as counterparty where Regenera acts for someone else. */
export async function engagementConflicts(db: Db, e: Pick<Engagement, "id" | "mandateId" | "orgId" | "projectId">) {
  const issues: { level: "review" | "conflict"; detail: string }[] = [];
  const live = ["scoping", "proposal", "negotiation", "contracting", "active", "waiting_on_client", "on_hold", "renewal"];
  if (e.projectId) {
    const others = await db.select({ name: engagements.name, orgId: engagements.orgId }).from(engagements).where(and(eq(engagements.mandateId, e.mandateId), eq(engagements.projectId, e.projectId), ne(engagements.id, e.id), inArray(engagements.status, live as never)));
    for (const o of others) if (o.orgId && o.orgId !== e.orgId) issues.push({ level: "review", detail: `Another client is engaged on the same project ("${o.name}")` });
  }
  if (e.orgId) {
    const parties = await db.select({ projectId: projectParties.projectId, role: projectParties.role }).from(projectParties).where(and(eq(projectParties.orgId, e.orgId), eq(projectParties.mandateId, e.mandateId)));
    for (const p of parties) {
      if (p.projectId === e.projectId) continue;
      const acting = await db.select({ name: engagements.name, orgId: engagements.orgId }).from(engagements).where(and(eq(engagements.projectId, p.projectId), inArray(engagements.status, live as never), ne(engagements.id, e.id)));
      for (const a of acting) if (a.orgId && a.orgId !== e.orgId) issues.push({ level: /lender|investor|offtaker|epc/.test(p.role) ? "conflict" : "review", detail: `Client is ${p.role} on a project where Regenera acts for another client ("${a.name}")` });
    }
  }
  return { status: issues.some(i => i.level === "conflict") ? "conflict" as const : issues.length ? "review" as const : "clear" as const, issues };
}

/** Status changes with gates: active needs a cleared (or reviewed and noted) conflict check and, when required, approval. */
export async function setEngagementStatus(db: Db, id: string, status: Status, actor: string, opts: { lostReason?: string } = {}) {
  const [e] = await db.select().from(engagements).where(eq(engagements.id, id));
  if (!e) throw new Error("Engagement not found");
  if (["contracting", "active"].includes(status)) {
    if (e.conflictStatus === "unchecked") throw new Error("Run the conflict check first");
    if (e.conflictStatus === "conflict") throw new Error("Conflict flagged: resolve or record the decision before contracting");
    if (e.conflictStatus === "review" && e.conflictNote.trim().length < 5) throw new Error("Conflict check needs review: record the decision in the conflict note");
  }
  if (status === "active" && e.approvalRequired && !e.approvedBy) throw new Error("This engagement type requires internal approval before it starts");
  await db.update(engagements).set({ status, lostReason: status === "lost" ? opts.lostReason ?? "" : e.lostReason, startDate: status === "active" && !e.startDate ? new Date().toISOString().slice(0, 10) : e.startDate, updatedAt: new Date().toISOString() }).where(eq(engagements.id, id));
  await audit(db, { actor, action: "engagement_status", entity: "engagements", entityId: id, before: { status: e.status }, after: { status } });
}

export function changeOrder(e: Pick<Engagement, "changeOrders">, input: { reason: string; description: string; fee: number; weeks: number }): ChangeOrder[] {
  return [...e.changeOrders, { id: uid(), ...input, status: "proposed", at: new Date().toISOString() }];
}

// ---------- invoices ----------
export async function nextInvoiceNumber(db: Db, mandateId: string, year = new Date().getUTCFullYear()) {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(invoices).where(and(eq(invoices.mandateId, mandateId), sql`${invoices.number} like ${`REG-${year}-%`}`));
  return `REG-${year}-${String(Number(r?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Status as of today from dates and payments (sent → due within 7 days → overdue). */
export function derivedInvoiceStatus(inv: Pick<typeof invoices.$inferSelect, "status" | "dueDate" | "amount" | "paidAmount">, today: string) {
  if (inv.status === "void" || inv.status === "draft" || inv.status === "scheduled") return inv.status;
  if (inv.paidAmount >= inv.amount - 0.005) return "paid";
  const partial = inv.paidAmount > 0;
  if (inv.dueDate && inv.dueDate < today) return "overdue";
  if (inv.dueDate && (Date.parse(inv.dueDate) - Date.parse(today)) / 86_400_000 <= 7) return partial ? "partially_paid" : "due";
  return partial ? "partially_paid" : inv.status;
}

export async function invoiceFromSchedule(db: Db, engagementId: string, lineId: string, issueDate: string, termsDays: number, actor: string) {
  const [e] = await db.select().from(engagements).where(eq(engagements.id, engagementId));
  if (!e) throw new Error("Engagement not found");
  const line = e.paymentSchedule.find(l => l.id === lineId);
  if (!line) throw new Error("Schedule line not found");
  if (line.invoiceId) throw new Error("Already invoiced");
  const due = new Date(Date.parse(issueDate) + termsDays * 86_400_000).toISOString().slice(0, 10);
  const [inv] = await db.insert(invoices).values({ mandateId: e.mandateId, engagementId, number: await nextInvoiceNumber(db, e.mandateId, Number(issueDate.slice(0, 4))), status: "draft", amount: line.amount, currency: e.currency, issueDate, dueDate: due, milestone: line.label }).returning();
  await db.update(engagements).set({ paymentSchedule: e.paymentSchedule.map(l => (l.id === lineId ? { ...l, invoiceId: inv.id } : l)), updatedAt: new Date().toISOString() }).where(eq(engagements.id, engagementId));
  await audit(db, { actor, action: "invoice_create", entity: "invoices", entityId: inv.id, after: { number: inv.number, amount: inv.amount } });
  return inv;
}

export async function recordPayment(db: Db, invoiceId: string, amount: number, date: string, actor: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "void" || inv.status === "draft") throw new Error("Send the invoice before recording a payment");
  const paid = r2(inv.paidAmount + amount);
  if (paid > inv.amount + 0.005) throw new Error("Payment exceeds the invoice amount");
  await db.update(invoices).set({ paidAmount: paid, paidAt: paid >= inv.amount - 0.005 ? date : inv.paidAt, status: paid >= inv.amount - 0.005 ? "paid" : "partially_paid", updatedAt: new Date().toISOString() }).where(eq(invoices.id, invoiceId));
  await audit(db, { actor, action: "invoice_payment", entity: "invoices", entityId: invoiceId, after: { amount, date, paid } });
}

// ---------- economics ----------
export function engagementEconomics(e: Engagement, invs: (typeof invoices.$inferSelect)[], exps: (typeof expenses.$inferSelect)[], time: (typeof timeEntries.$inferSelect)[]) {
  const approvedCO = e.changeOrders.filter(c => c.status === "approved").reduce((a, c) => a + c.fee, 0);
  const contractValue = e.fee + e.monthlyFee * e.months + approvedCO;
  const live = invs.filter(i => i.status !== "void");
  const invoiced = live.filter(i => i.status !== "draft" && i.status !== "scheduled").reduce((a, i) => a + i.amount, 0);
  const collected = live.reduce((a, i) => a + i.paidAmount, 0);
  const hours = time.reduce((a, t) => a + t.hours, 0);
  const internalCost = e.hourlyCost ? hours * e.hourlyCost : null;
  const partnerCost = e.partners.reduce((a, p) => a + (p.cost || 0), 0);
  const expenseCost = exps.filter(x => x.classification !== "pass_through").reduce((a, x) => a + x.amount, 0);
  const reimbursable = exps.filter(x => x.classification === "reimbursable").reduce((a, x) => a + x.amount, 0);
  const externalCost = partnerCost + expenseCost;
  const revenue = contractValue + reimbursable;
  const cost = externalCost + (internalCost ?? 0);
  return {
    contractValue: r2(contractValue), invoiced: r2(invoiced), collected: r2(collected), outstanding: r2(invoiced - collected), toInvoice: r2(contractValue - live.reduce((a, i) => a + i.amount, 0)),
    hours, internalCost: internalCost === null ? null : r2(internalCost), externalCost: r2(externalCost), grossMargin: r2(revenue - cost), marginPct: revenue > 0 ? r2(((revenue - cost) / revenue) * 100) : null,
    hoursVsPlanPct: e.expectedHours > 0 ? r2((hours / e.expectedHours) * 100) : null, internalCostKnown: internalCost !== null,
    probabilityPct: e.probabilityPct ?? STAGE_PROBABILITY[e.status], weighted: r2(contractValue * ((e.probabilityPct ?? STAGE_PROBABILITY[e.status]) / 100)),
  };
}

/** Portfolio view: pipeline, receivables, MRR/ARR, profitability by service and by client. */
export async function commercialOverview(db: Db, mandateIds: string[], today = new Date().toISOString().slice(0, 10)) {
  if (!mandateIds.length) return null;
  const es = await db.select().from(engagements).where(sql`${engagements.mandateId} in ${mandateIds}`).orderBy(desc(engagements.updatedAt));
  const ids = es.map(e => e.id);
  const [invs, exps, time] = ids.length ? await Promise.all([
    db.select().from(invoices).where(inArray(invoices.engagementId, ids)), db.select().from(expenses).where(inArray(expenses.engagementId, ids)), db.select().from(timeEntries).where(inArray(timeEntries.engagementId, ids)),
  ]) : [[], [], []];
  const orgIds = [...new Set(es.map(e => e.orgId).filter((x): x is string => !!x))];
  const orgs = orgIds.length ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)) : [];
  const orgName = new Map(orgs.map(o => [o.id, o.name]));
  const rows = es.map(e => ({ e, client: e.orgId ? orgName.get(e.orgId) ?? "—" : "—", econ: engagementEconomics(e, invs.filter(i => i.engagementId === e.id), exps.filter(x => x.engagementId === e.id), time.filter(t => t.engagementId === e.id)) }));
  const open = rows.filter(r => ["prospect", "qualified", "discovery", "scoping", "proposal", "negotiation", "contracting", "renewal"].includes(r.e.status));
  const active = rows.filter(r => ["active", "waiting_on_client", "on_hold"].includes(r.e.status));
  const liveInv = invs.filter(i => i.status !== "void").map(i => ({ ...i, derived: derivedInvoiceStatus(i, today) }));
  const byService = new Map<string, { contract: number; margin: number; revenue: number; count: number }>();
  const byClient = new Map<string, { contract: number; collected: number; count: number }>();
  for (const r of rows.filter(x => !["prospect", "lost"].includes(x.e.status))) {
    const k = r.e.workstreams[0] ?? "unassigned";
    const s = byService.get(k) ?? { contract: 0, margin: 0, revenue: 0, count: 0 };
    s.contract += r.econ.contractValue; s.margin += r.econ.grossMargin; s.revenue += r.econ.contractValue; s.count++; byService.set(k, s);
    const c = byClient.get(r.client) ?? { contract: 0, collected: 0, count: 0 }; c.contract += r.econ.contractValue; c.collected += r.econ.collected; c.count++; byClient.set(r.client, c);
  }
  const mrr = active.filter(r => r.e.monthlyFee > 0).reduce((a, r) => a + r.e.monthlyFee, 0);
  return {
    rows, invoices: liveInv,
    pipelineValue: r2(open.reduce((a, r) => a + r.econ.contractValue, 0)), pipelineWeighted: r2(open.reduce((a, r) => a + r.econ.weighted, 0)),
    activeValue: r2(active.reduce((a, r) => a + r.econ.contractValue, 0)), mrr: r2(mrr), arr: r2(mrr * 12),
    receivables: r2(liveInv.reduce((a, i) => a + (i.derived === "paid" || i.derived === "draft" || i.derived === "scheduled" ? 0 : i.amount - i.paidAmount), 0)),
    overdue: liveInv.filter(i => i.derived === "overdue"), dueSoon: liveInv.filter(i => i.derived === "due" || i.derived === "partially_paid"),
    byService: [...byService.entries()].map(([k, v]) => ({ service: k, ...v, marginPct: v.revenue ? r2((v.margin / v.revenue) * 100) : null })).sort((a, b) => b.contract - a.contract),
    byClient: [...byClient.entries()].map(([k, v]) => ({ client: k, ...v })).sort((a, b) => b.contract - a.contract),
    winRate: (() => { const decided = rows.filter(r => r.e.status === "lost" || !["prospect", "qualified", "discovery", "scoping", "proposal", "negotiation", "contracting"].includes(r.e.status)); const won = decided.filter(r => r.e.status !== "lost"); return decided.length ? r2((won.length / decided.length) * 100) : null; })(),
  };
}

/** Command items: overdue receivables, invoices due, proposals waiting, contracting, proposed change orders. */
export async function commercialAttention(db: Db, mandateIds: string[], today = new Date().toISOString().slice(0, 10)) {
  const o = await commercialOverview(db, mandateIds, today);
  if (!o) return [];
  const out: { key: string; entity: string; issue: string; severity: "critical" | "high" | "medium"; due: string | null; href: string }[] = [];
  const name = new Map(o.rows.map(r => [r.e.id, `${r.e.name} · ${r.client}`]));
  for (const i of o.overdue) {
    const days = i.dueDate ? Math.round((Date.parse(today) - Date.parse(i.dueDate)) / 86_400_000) : 0;
    out.push({ key: `inv:${i.id}`, entity: name.get(i.engagementId) ?? "Engagement", issue: `Invoice ${i.number} overdue ${days} days (${i.currency} ${(i.amount - i.paidAmount).toLocaleString("en-US")})`, severity: days >= 30 ? "critical" : days >= 7 ? "high" : "medium", due: i.dueDate, href: `/commercial/engagements/${i.engagementId}` });
  }
  for (const i of o.dueSoon) out.push({ key: `due:${i.id}`, entity: name.get(i.engagementId) ?? "Engagement", issue: `Invoice ${i.number} due ${i.dueDate}`, severity: "medium", due: i.dueDate, href: `/commercial/engagements/${i.engagementId}` });
  for (const r of o.rows) {
    const age = Math.round((Date.parse(today) - Date.parse(r.e.updatedAt.slice(0, 10))) / 86_400_000);
    if (r.e.status === "proposal" && age >= 10) out.push({ key: `prop:${r.e.id}`, entity: `${r.e.name} · ${r.client}`, issue: `Proposal waiting ${age} days`, severity: "medium", due: null, href: `/commercial/engagements/${r.e.id}` });
    if (r.e.status === "contracting") out.push({ key: `ctr:${r.e.id}`, entity: `${r.e.name} · ${r.client}`, issue: "Contract awaiting signature", severity: "medium", due: null, href: `/commercial/engagements/${r.e.id}` });
    if (r.e.changeOrders.some(c => c.status === "proposed")) out.push({ key: `co:${r.e.id}`, entity: `${r.e.name} · ${r.client}`, issue: "Change order awaiting approval", severity: "medium", due: null, href: `/commercial/engagements/${r.e.id}` });
    const late = r.e.deliverables.filter(d => d.due && d.due < today && !["delivered", "accepted"].includes(d.status));
    if (late.length && ["active", "waiting_on_client"].includes(r.e.status)) out.push({ key: `dlv:${r.e.id}`, entity: `${r.e.name} · ${r.client}`, issue: `${late.length} deliverable(s) past due`, severity: "high", due: late[0].due, href: `/commercial/engagements/${r.e.id}` });
  }
  return out;
}

/** Proposal text (Markdown for the branded PDF). Missing fields say so; fees come from the engagement. */
export function proposalMarkdown(e: Engagement, client: string, project: string | null, svc: Pick<Service, "key" | "name" | "depth" | "deliverables" | "timelineWeeks" | "role" | "specialistRequired" | "legalNotes">[]) {
  const money = (n: number) => `${e.currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const tbc = (s: string) => (s.trim() ? s : "[TO CONFIRM]");
  const weeks = Math.max(0, ...svc.map(s => s.timelineWeeks));
  return [
    `# Proposal: ${e.name}`,
    `**Client:** ${client}${project ? `  \n**Project:** ${project}` : ""}  \n**Date:** ${new Date().toISOString().slice(0, 10)}`,
    "## Context and objectives", tbc(e.scope.split("\n")[0] ?? ""),
    "## Scope", ...svc.map(s => `- **${s.name}${s.depth !== "standard" ? ` (${s.depth})` : ""}**: Regenera role: ${s.role.replace(/_/g, " ")}.`),
    "## Deliverables", ...(e.deliverables.length ? e.deliverables.map(d => `- ${d.label}${d.due ? ` (due ${d.due})` : ""}`) : ["[TO CONFIRM]"]),
    "## Timeline", weeks ? `Indicative duration: ${weeks} weeks from kickoff and receipt of client inputs.` : "[TO CONFIRM]",
    "## Client responsibilities", tbc(e.clientResponsibilities),
    "## Specialists of record", ...(svc.flatMap(s => s.specialistRequired).length ? [...new Set(svc.flatMap(s => s.specialistRequired))].map(x => `- ${x} (engaged separately; Regenera coordinates)`) : ["None anticipated."]),
    "## Fees and payment", e.fee ? `Fixed fee: ${money(e.fee)}.` : "", e.monthlyFee ? `Monthly fee: ${money(e.monthlyFee)} for ${e.months} months.` : "",
    ...e.paymentSchedule.map(l => `- ${l.label}: ${money(l.amount)}`), `Payment terms: ${e.paymentTerms}. Expenses: approved reimbursable expenses at cost.`,
    "## Assumptions", tbc(e.assumptions), "## Exclusions", tbc(e.exclusions),
    ...svc.filter(s => s.legalNotes).map(s => `> ${s.legalNotes}`),
    "## Terms", "Subject to Regenera's MSA and a statement of work. This proposal is not legal, tax or investment advice.",
    "## Next steps", "1. Confirm scope and fees  \n2. NDA and engagement letter / SOW  \n3. Deposit and kickoff  \n4. Data request",
  ].filter(Boolean).join("\n\n");
}

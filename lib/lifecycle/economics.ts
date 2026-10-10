// Owner economics (phase 29A): Regenera's own money, per currency, in separate stages. Proposed fees come from sent
// proposal versions; contracted from engagements; invoiced and collected from invoices and payments; delivery cost from
// expenses and partner costs (logged time only where an internal rate is recorded). No currency is converted, no stage
// probability is applied, and project capital or investor commitments are never part of these figures.
import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { engagements, expenses, invoices, offerProposals, offerProposalVersions, payments, timeEntries } from "@/db/schema";
import { versionTotal } from "./proposals";

export type CurrencyLine = { costStatus?: "recorded" | "none" | "rate_missing"; currency: string; proposed: number; proposedUnpriced: number; contracted: number; invoiced: number; collected: number; outstanding: number; overdue: number; deliveryCost: number; costUnknown: number; margin: number | null; recurringMonthly: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const LIVE = ["contracting", "active", "waiting_on_client", "on_hold", "renewal", "complete", "closed"];

export async function ownerEconomics(db: Db, mandateIds: string[], today = new Date().toISOString().slice(0, 10)) {
  if (!mandateIds.length) return { lines: [] as CurrencyLine[], definitions: DEFINITIONS };
  const lines = new Map<string, CurrencyLine>();
  const line = (c: string) => { let l = lines.get(c); if (!l) { l = { currency: c, proposed: 0, proposedUnpriced: 0, contracted: 0, invoiced: 0, collected: 0, outstanding: 0, overdue: 0, deliveryCost: 0, costUnknown: 0, margin: null, recurringMonthly: 0 }; lines.set(c, l); } return l; };

  const ps = await db.select().from(offerProposals).where(inArray(offerProposals.mandateId, mandateIds));
  const open = ps.filter(p => p.status === "sent");
  const vs = open.length ? await db.select().from(offerProposalVersions).where(inArray(offerProposalVersions.proposalId, open.map(p => p.id))) : [];
  for (const v of vs.filter(v => v.status === "sent")) { const t = versionTotal(v); if (t == null) line(v.currency).proposedUnpriced++; else line(v.currency).proposed += t; }

  const es = (await db.select().from(engagements).where(inArray(engagements.mandateId, mandateIds))).filter(e => LIVE.includes(e.status));
  const ids = es.map(e => e.id);
  const [invs, exps, time] = ids.length ? await Promise.all([
    db.select().from(invoices).where(inArray(invoices.engagementId, ids)), db.select().from(expenses).where(inArray(expenses.engagementId, ids)), db.select().from(timeEntries).where(inArray(timeEntries.engagementId, ids)),
  ]) : [[], [], []];
  const pays = invs.length ? await db.select().from(payments).where(inArray(payments.invoiceId, invs.map(i => i.id))) : [];
  const costKnown = new Map<string, boolean>();
  const costRecorded = new Set<string>();
  for (const e of es) {
    const l = line(e.currency);
    l.contracted += e.fee + e.monthlyFee * e.months;
    if (["active", "waiting_on_client", "on_hold", "renewal"].includes(e.status)) l.recurringMonthly += e.monthlyFee;
    const hours = time.filter(t => t.engagementId === e.id).reduce((a, t) => a + t.hours, 0);
    if (hours > 0 && !e.hourlyCost) { l.costUnknown++; costKnown.set(e.currency, false); }
    const partnerAndTime = e.partners.reduce((a, p) => a + (p.cost || 0), 0) + (e.hourlyCost ? hours * e.hourlyCost : 0);
    l.deliveryCost += partnerAndTime;
    if (partnerAndTime > 0) costRecorded.add(e.currency);
    // Expenses in another currency are not converted: they are listed under their own currency.
    for (const x of exps.filter(x => x.engagementId === e.id && x.classification !== "pass_through")) { line(x.currency).deliveryCost += x.amount; costRecorded.add(x.currency); }
  }
  for (const i of invs.filter(i => !["void", "draft", "scheduled"].includes(i.status))) {
    const l = line(i.currency);
    const got = pays.filter(p => p.invoiceId === i.id).reduce((a, p) => a + p.amount, 0) || i.paidAmount;
    l.invoiced += i.amount; l.collected += got; l.outstanding += Math.max(0, i.amount - got);
    if (i.dueDate && i.dueDate < today && got < i.amount - 0.005) l.overdue += i.amount - got;
  }
  const out = [...lines.values()].map(l => ({
    ...l, proposed: r2(l.proposed), contracted: r2(l.contracted), invoiced: r2(l.invoiced), collected: r2(l.collected), outstanding: r2(l.outstanding), overdue: r2(l.overdue), deliveryCost: r2(l.deliveryCost), recurringMonthly: r2(l.recurringMonthly),
    // No margin without recorded costs: a fee with no costs logged is not a 100 % margin.
    margin: costKnown.get(l.currency) === false || !l.contracted || !costRecorded.has(l.currency) ? null : r2(l.contracted - l.deliveryCost),
    costStatus: costKnown.get(l.currency) === false ? "rate_missing" as const : costRecorded.has(l.currency) ? "recorded" as const : "none" as const,
  }));
  return { lines: out.sort((a, b) => a.currency.localeCompare(b.currency)), definitions: DEFINITIONS };
}

export const DEFINITIONS = {
  proposed: "Total of proposal versions sent and awaiting a decision. Not weighted by any probability.",
  contracted: "Fees in engagements from signature onwards (one-off plus retainer months).",
  invoiced: "Invoices issued (not draft, scheduled or void).",
  collected: "Payments received with evidence, less refunds and credits.",
  outstanding: "Invoiced minus collected.",
  deliveryCost: "Partner costs, non-pass-through expenses and logged time at the recorded internal rate.",
  margin: "Contracted minus delivery cost; not shown until costs are recorded, or when logged time has no internal rate.",
  recurringMonthly: "Monthly retainers in engagements in delivery.",
};

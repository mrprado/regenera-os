// Regenera's own commercial metrics (company model, §30 "what Regenera should track commercially"). Each figure has a
// stated definition; recurring software revenue (ARR) is never mixed with advisory retainers or one-off work, and
// none of this is mixed with project finance. Currencies are summed only within the same currency.
import type { engagements } from "@/db/schema";
import { REVENUE_CATEGORIES, type RevenueCategory } from "./vocab";

type Engagement = typeof engagements.$inferSelect;
type Econ = { contractValue: number; invoiced: number; weighted: number; grossMargin: number; internalCostKnown: boolean };
export type Row = { e: Engagement; econ: Econ };

const LIVE = new Set(["active", "waiting_on_client", "on_hold", "renewal"]);
const OPEN = new Set(["prospect", "qualified", "discovery", "scoping", "proposal", "negotiation", "contracting"]);
const WON = new Set(["contracting", "active", "waiting_on_client", "on_hold", "complete", "renewal", "closed"]);
const BACKLOG_CATS = new Set<RevenueCategory>(["implementation", "systems_build", "custom_development"]);

/** The recorded category, or one inferred from type/billing (shown as inferred so the user can confirm it). */
export function categoryOf(e: Pick<Engagement, "revenueCategory" | "engagementType" | "billingType">): { category: RevenueCategory; inferred: boolean } {
  if (e.revenueCategory) return { category: e.revenueCategory, inferred: false };
  const byType: Partial<Record<NonNullable<Engagement["engagementType"]>, RevenueCategory>> = {
    diagnostic: "diagnostic", platform_subscription: "subscription", systems_build: "systems_build", custom_os: "systems_build", capital_advisory: "capital_advisory", ongoing_monitoring: "monitoring",
  };
  const t = e.engagementType ? byType[e.engagementType] : undefined;
  if (t) return { category: t, inferred: true };
  if (e.billingType === "subscription") return { category: "subscription", inferred: true };
  if (e.billingType === "monthly_retainer" || e.billingType === "project_retainer") return { category: "retainer", inferred: true };
  return { category: "advisory", inferred: true };
}

export function commercialMetrics(rows: Row[], today = new Date().toISOString().slice(0, 10)) {
  const horizon = new Date(Date.parse(today) + 120 * 86_400_000).toISOString().slice(0, 10);
  const byCur = <T extends Record<string, number>>() => new Map<string, T>();
  const money = byCur<{ arr: number; advisoryMrr: number; otherMrr: number; backlog: number; pipeline: number; weighted: number; renewals: number; activeValue: number }>();
  const bucket = (cur: string) => { let m = money.get(cur); if (!m) { m = { arr: 0, advisoryMrr: 0, otherMrr: 0, backlog: 0, pipeline: 0, weighted: 0, renewals: 0, activeValue: 0 }; money.set(cur, m); } return m; };
  const mix = new Map<string, { category: RevenueCategory; currency: string; contract: number; margin: number; marginKnown: boolean; count: number }>();
  const renewing: { id: string; name: string; date: string; currency: string; value: number }[] = [];
  let inferred = 0;

  for (const { e, econ } of rows) {
    const { category, inferred: inf } = categoryOf(e);
    if (inf && (LIVE.has(e.status) || WON.has(e.status))) inferred++;
    const m = bucket(e.currency);
    const recurring = REVENUE_CATEGORIES[category].recurring;
    const monthly = e.monthlyFee > 0 ? e.monthlyFee : recurring && e.fee > 0 ? e.fee / 12 : 0;
    if (LIVE.has(e.status)) {
      m.activeValue += econ.contractValue;
      if (category === "subscription") m.arr += monthly * 12;
      else if (category === "retainer") m.advisoryMrr += monthly;
      else if (recurring) m.otherMrr += monthly;
      const renewal = e.renewalDate ?? e.endDate;
      if (renewal && renewal >= today && renewal <= horizon) { const v = recurring ? monthly * 12 : econ.contractValue; m.renewals += v; renewing.push({ id: e.id, name: e.name, date: renewal, currency: e.currency, value: v }); }
    }
    if ((LIVE.has(e.status) || e.status === "contracting") && BACKLOG_CATS.has(category)) m.backlog += Math.max(0, econ.contractValue - econ.invoiced);
    if (OPEN.has(e.status)) { m.pipeline += econ.contractValue; m.weighted += econ.weighted; }
    if (WON.has(e.status)) {
      const k = `${category}|${e.currency}`;
      const x = mix.get(k) ?? { category, currency: e.currency, contract: 0, margin: 0, marginKnown: true, count: 0 };
      x.contract += econ.contractValue; x.margin += econ.grossMargin; x.marginKnown &&= econ.internalCostKnown; x.count++;
      mix.set(k, x);
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    byCurrency: [...money.entries()].map(([currency, v]) => ({ currency, ...Object.fromEntries(Object.entries(v).map(([k, n]) => [k, r(n)])) } as { currency: string; arr: number; advisoryMrr: number; otherMrr: number; backlog: number; pipeline: number; weighted: number; renewals: number; activeValue: number })),
    mix: [...mix.values()].map(x => ({ ...x, contract: r(x.contract), margin: r(x.margin), marginPct: x.contract > 0 ? r((x.margin / x.contract) * 100) : null })).sort((a, b) => b.contract - a.contract),
    renewing: renewing.sort((a, b) => a.date.localeCompare(b.date)),
    inferredCategories: inferred,
    definitions: {
      arr: "Platform subscriptions in active engagements × 12 (monthly fee, or annual fee when billed yearly).",
      advisoryMrr: "Monthly advisory retainers in active engagements.",
      otherMrr: "Other recurring revenue (monitoring, data, support) per month.",
      backlog: "Contracted implementation, systems-build and custom-development value not yet invoiced.",
      weighted: "Open pipeline × stage probability (editable per engagement).",
      renewals: "Active engagements whose renewal or end date falls within 120 days (annualised for recurring work).",
      margin: "Contract value minus partner, expense and logged-time cost; shown only where an internal cost rate is recorded.",
    },
  };
}

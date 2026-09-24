// Forecast (docs/plans/phase-4.md item 4). Weighted value by expected close month for the next 6 months.
// Stage probabilities are calibrated from this CRM's own history once a stage has 10+ closed deals that passed
// through it, and use STAGE_PROBABILITY until then. Retainers contribute their monthly value each month.
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, deals } from "@/db/schema";
import { DEAL_STAGES } from "@/lib/vocab";
import { STAGE_PROBABILITY } from "./metrics";

type Stage = keyof typeof DEAL_STAGES;
const WON = new Set<Stage>(["signed", "active", "expansion", "completed"]);
const OPEN_ORDER: Stage[] = ["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "expansion"];
export const MIN_CLOSED_PER_STAGE = 10;
const LABEL_TO_KEY = new Map(Object.entries(DEAL_STAGES).map(([k, v]) => [v.toLowerCase(), k as Stage]));

/** Stages a deal passed through, read from stage_change activities ("A → B", "Created at A: ..."). */
export function stagesFromHistory(details: string[], current: Stage): Set<Stage> {
  const out = new Set<Stage>([current]);
  for (const d of details) {
    const created = d.match(/^Created at ([^:]+)/);
    const moved = d.match(/^(.+?) → (.+?)(?: \(|:|$)/);
    for (const label of [created?.[1], moved?.[1], moved?.[2]]) {
      const k = label ? LABEL_TO_KEY.get(label.trim().toLowerCase()) : undefined;
      if (k) out.add(k);
    }
  }
  return out;
}

export async function stageProbabilities(db: Db, mandateIds: string[]) {
  const closed = await db.select({ id: deals.id, stage: deals.stage }).from(deals)
    .where(and(inArray(deals.mandateId, mandateIds), inArray(deals.stage, ["signed", "active", "expansion", "completed", "lost"])));
  const history = closed.length ? await db.select({ dealId: activities.dealId, detail: activities.detail }).from(activities)
    .where(and(inArray(activities.mandateId, mandateIds), eq(activities.type, "stage_change"))) : [];
  const counts = new Map<Stage, { won: number; lost: number }>();
  for (const d of closed) {
    const reached = stagesFromHistory(history.filter(h => h.dealId === d.id).map(h => h.detail), d.stage as Stage);
    const won = WON.has(d.stage as Stage);
    for (const s of reached) {
      const c = counts.get(s) ?? { won: 0, lost: 0 };
      if (won) c.won++; else c.lost++;
      counts.set(s, c);
    }
  }
  return Object.fromEntries(OPEN_ORDER.map(s => {
    const c = counts.get(s) ?? { won: 0, lost: 0 };
    const n = c.won + c.lost;
    return [s, n >= MIN_CLOSED_PER_STAGE ? { p: Math.round((c.won / n) * 100), source: "calibrated" as const, n } : { p: STAGE_PROBABILITY[s] ?? 0, source: "default" as const, n }];
  })) as Record<Stage, { p: number; source: "calibrated" | "default"; n: number }>;
}

export type ForecastMonth = { month: string; weighted: number; byPractice: Record<string, number>; byFeeType: Record<string, number>; deals: number };

export async function forecast(db: Db, mandateIds: string[], now = new Date(), months = 6) {
  if (!mandateIds.length) mandateIds = ["__none__"];
  const probs = await stageProbabilities(db, mandateIds);
  const open = await db.select().from(deals).where(and(inArray(deals.mandateId, mandateIds), isNull(deals.archivedAt), inArray(deals.stage, OPEN_ORDER)));
  const keys = Array.from({ length: months }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  const out: ForecastMonth[] = keys.map(month => ({ month, weighted: 0, byPractice: {}, byFeeType: {}, deals: 0 }));
  let noDate = { deals: 0, weighted: 0 };
  const add = (m: ForecastMonth, v: number, practice: string, fee: string) => {
    m.weighted += v; m.byPractice[practice] = (m.byPractice[practice] ?? 0) + v; m.byFeeType[fee] = (m.byFeeType[fee] ?? 0) + v;
  };
  for (const d of open) {
    const p = (d.probability ?? probs[d.stage as Stage]?.p ?? 0) / 100;
    const practice = d.practice ?? "unassigned";
    if (!d.expectedClose) { noDate = { deals: noDate.deals + 1, weighted: noDate.weighted + (d.valueEstimate ?? 0) * p }; continue; }
    const start = d.expectedClose.slice(0, 7) < keys[0] ? keys[0] : d.expectedClose.slice(0, 7);
    const i = keys.indexOf(start);
    if (i < 0) continue; // beyond the window
    if (d.valueEstimate) { add(out[i], d.valueEstimate * p, practice, d.feeType); out[i].deals++; }
    if (d.monthlyValue) for (let j = i; j < out.length; j++) add(out[j], d.monthlyValue * p, practice, "monthly_retainer");
  }
  for (const m of out) m.weighted = Math.round(m.weighted);
  return { months: out, noDate: { deals: noDate.deals, weighted: Math.round(noDate.weighted) }, probabilities: probs };
}

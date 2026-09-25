// Economics engine (docs/plans/phase-6.md M8): stores screening cases with their computed outputs and derives the
// downside and upside cases from a base case with documented shocks.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { economicCases, projects, revenueStreams } from "@/db/schema";
import { audit } from "@/lib/audit";
import { runCase, SCENARIOS } from "./model";
import type { CaseInputs } from "./vocab";

/** Year-1 revenue implied by the recorded revenue streams in one currency; other currencies are listed, not converted. */
export function revenueFromStreams(streams: (typeof revenueStreams.$inferSelect)[], currency: string) {
  let total = 0;
  const skipped: string[] = [];
  for (const s of streams) {
    if (s.status === "lost") continue;
    if (s.unitPrice === null || s.annualVolume === null) { skipped.push(`${s.name || s.mechanism}: price or volume missing`); continue; }
    if (s.currency !== currency) { skipped.push(`${s.name || s.mechanism}: in ${s.currency}`); continue; }
    total += s.unitPrice * s.annualVolume;
  }
  return { total, skipped };
}

export async function saveCase(db: Db, projectId: string, input: { name: string; kind: "base" | "downside" | "upside" | "custom"; inputs: CaseInputs; source?: string; baseCaseId?: string | null }, actor: string) {
  const [p] = await db.select({ mandateId: projects.mandateId }).from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Project not found");
  const [c] = await db.insert(economicCases).values({
    projectId, mandateId: p.mandateId, name: input.name, kind: input.kind, inputs: input.inputs, outputs: runCase(input.inputs),
    source: input.source ?? "", baseCaseId: input.baseCaseId ?? null, preparedBy: actor,
  }).returning();
  await audit(db, { actor, action: "economic_case_saved", entity: "economic_cases", entityId: c.id, after: { name: c.name, kind: c.kind } });
  return c;
}

export async function updateCaseInputs(db: Db, caseId: string, inputs: CaseInputs, actor: string) {
  const [c] = await db.select().from(economicCases).where(eq(economicCases.id, caseId));
  if (!c) throw new Error("Case not found");
  await db.update(economicCases).set({ inputs, outputs: runCase(inputs), updatedAt: new Date().toISOString() }).where(eq(economicCases.id, caseId));
  await audit(db, { actor, action: "economic_case_updated", entity: "economic_cases", entityId: caseId, before: c.inputs, after: inputs });
  if (c.kind === "base") await deriveScenarios(db, caseId, actor);
}

/** Creates or refreshes the downside and upside cases of a base case. */
export async function deriveScenarios(db: Db, baseCaseId: string, actor: string) {
  const [base] = await db.select().from(economicCases).where(eq(economicCases.id, baseCaseId));
  if (!base) throw new Error("Case not found");
  for (const kind of ["downside", "upside"] as const) {
    const s = SCENARIOS[kind];
    const inputs = s.apply(base.inputs);
    const source = `Derived from ${base.name}: ${s.shocks.join(", ")}`;
    const [existing] = await db.select().from(economicCases).where(and(eq(economicCases.baseCaseId, baseCaseId), eq(economicCases.kind, kind)));
    if (existing) await db.update(economicCases).set({ inputs, outputs: runCase(inputs), source, updatedAt: new Date().toISOString() }).where(eq(economicCases.id, existing.id));
    else await saveCase(db, base.projectId, { name: `${base.name} · ${s.label}`, kind, inputs, source, baseCaseId }, actor);
  }
}

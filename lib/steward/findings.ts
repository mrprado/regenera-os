// Steward findings (phase 29E): stewardship values become decisions and obligations. A material finding needs
// evidence, its implication for the project, the required action, an owner and a review date; it creates a task for
// the owner and stays on the project's readiness until resolved with evidence. Unknown uncertainty stays "unknown".
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { stewardFindings, tasks } from "@/db/schema";
import { audit } from "@/lib/audit";

export const FINDING_DIMENSIONS = {
  water: "Water and watersheds", ecology: "Ecology and biodiversity", land_history: "Land-use history", soil: "Agriculture and soil",
  community: "Community impacts and benefits", heritage: "Cultural heritage", tek: "Traditional ecological knowledge", custodianship: "Knowledge custodianship and consent",
  management: "Long-term management", monitoring: "Monitoring obligations",
} as const;

export type FindingInput = {
  mandateId: string; placeId?: string | null; projectId?: string | null; dimension: keyof typeof FINDING_DIMENSIONS; subject: string; scope?: string;
  evidence: string; affectedParties?: string; uncertainty?: "low" | "moderate" | "high" | "unknown"; implication: string; requiredAction: string;
  materiality?: "material" | "minor"; owner?: string | null; reviewDate?: string | null;
};

export async function createFinding(db: Db, input: FindingInput, by: string) {
  if (!input.placeId && !input.projectId) throw new Error("A finding belongs to a place or a project.");
  for (const [k, label] of [["subject", "a subject"], ["evidence", "evidence"], ["implication", "what it means for the project"], ["requiredAction", "the required action"]] as const) if (!String(input[k] ?? "").trim()) throw new Error(`A finding needs ${label}.`);
  const material = (input.materiality ?? "material") === "material";
  if (material && (!input.owner?.trim() || !input.reviewDate)) throw new Error("A material finding needs an owner and a review date.");
  const [f] = await db.insert(stewardFindings).values({ ...input, uncertainty: input.uncertainty ?? "unknown", materiality: input.materiality ?? "material", createdBy: by }).returning();
  if (input.owner && input.reviewDate) {
    const [t] = await db.insert(tasks).values({ mandateId: input.mandateId, projectId: input.projectId ?? null, type: "other", title: `Steward: ${input.requiredAction}`, body: `${FINDING_DIMENSIONS[input.dimension]} · ${input.subject}. ${input.implication}`, dueAt: `${input.reviewDate}T09:00:00.000Z`, owner: input.owner, workstream: `steward-finding:${f.id}` }).returning({ id: tasks.id });
    await db.update(stewardFindings).set({ taskId: t.id }).where(eq(stewardFindings.id, f.id));
  }
  await audit(db, { actor: by, action: "steward_finding_created", entity: "steward_findings", entityId: f.id, after: { dimension: input.dimension, material } });
  return f;
}

/** Monitoring needs a next review date; resolving needs evidence. */
export async function setFindingStatus(db: Db, id: string, status: "monitoring" | "resolved" | "open", input: { evidence?: string; reviewDate?: string | null }, by: string) {
  const [f] = await db.select().from(stewardFindings).where(eq(stewardFindings.id, id));
  if (!f) throw new Error("Finding not found");
  const t = new Date().toISOString();
  if (status === "resolved" && !input.evidence?.trim()) throw new Error("Resolving a finding needs the evidence that it is resolved.");
  if (status === "monitoring" && !(input.reviewDate ?? f.reviewDate)) throw new Error("Monitoring needs a review date.");
  await db.update(stewardFindings).set({ status, reviewDate: input.reviewDate ?? f.reviewDate, resolutionEvidence: status === "resolved" ? input.evidence! : f.resolutionEvidence, resolvedBy: status === "resolved" ? by : f.resolvedBy, resolvedAt: status === "resolved" ? t : f.resolvedAt, updatedAt: t }).where(eq(stewardFindings.id, id));
  if (status === "resolved" && f.taskId) await db.update(tasks).set({ status: "done", completedAt: t }).where(eq(tasks.id, f.taskId));
  await audit(db, { actor: by, action: `steward_finding_${status}`, entity: "steward_findings", entityId: id });
}

export async function findingsFor(db: Db, projectId: string, placeIds: string[] = []) {
  const byProject = await db.select().from(stewardFindings).where(eq(stewardFindings.projectId, projectId)).orderBy(asc(stewardFindings.status), asc(stewardFindings.reviewDate));
  const byPlace = placeIds.length ? await db.select().from(stewardFindings).where(and(inArray(stewardFindings.placeId, placeIds))) : [];
  const seen = new Set<string>();
  return [...byProject, ...byPlace].filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

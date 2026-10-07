// Data room completeness, computed from the documents register and records (never assembled by hand). A folder is
// "filled" by an approved or executed document of a matching category, or by a record that is the evidence itself
// (a grid connection, an insurance-class document, community records for ESG). Counts, not a percentage score.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { documents, gridConnections, landControls, stakeholders } from "@/db/schema";
import { DATA_ROOM_FOLDERS } from "@/lib/ontology/taxonomies";

export type FolderState = { key: string; label: string; final: number; drafts: number; records: string[]; state: "filled" | "draft_only" | "empty" };

const FINAL = new Set(["approved", "executed"]);

export async function dataRoom(db: Db, mandateIds: string[], projectId: string): Promise<FolderState[]> {
  if (!mandateIds.length) return [];
  const [docs, grid, land, people] = await Promise.all([
    db.select({ category: documents.category, status: documents.status, title: documents.title }).from(documents).where(and(inArray(documents.mandateId, mandateIds), eq(documents.projectId, projectId))),
    db.select({ id: gridConnections.id }).from(gridConnections).where(and(inArray(gridConnections.mandateId, mandateIds), eq(gridConnections.projectId, projectId))),
    db.select({ id: landControls.id, title: landControls.titleEvidence }).from(landControls).where(and(inArray(landControls.mandateId, mandateIds), eq(landControls.projectId, projectId))),
    db.select({ id: stakeholders.id }).from(stakeholders).where(and(inArray(stakeholders.mandateId, mandateIds), eq(stakeholders.projectId, projectId))),
  ]);
  return DATA_ROOM_FOLDERS.map(f => {
    const byTitle = (re: RegExp) => docs.filter(d => re.test(d.title));
    const inFolder = [...docs.filter(d => f.categories.includes(d.category)),
      ...(f.key === "grid" ? byTitle(/grid|interconnect|connection|substation/i) : []),
      ...(f.key === "insurance" ? byTitle(/insur|policy|bond/i) : []),
      ...(f.key === "esg" ? byTitle(/esg|e&s|esia|social|biodiversity|tnfd|safeguard/i) : [])];
    const records: string[] = [];
    if (f.key === "grid" && grid.length) records.push(`${grid.length} grid connection record(s)`);
    if (f.key === "land" && land.length) records.push(`${land.length} parcel(s) with land control, ${land.filter(l => l.title === "legal_opinion" || l.title === "searched").length} with title searched or opined`);
    if (f.key === "esg" && people.length) records.push(`${people.length} stakeholder(s) registered`);
    const final = inFolder.filter(d => FINAL.has(d.status)).length, drafts = inFolder.length - final;
    return { key: f.key, label: f.label, final, drafts, records, state: final ? "filled" : drafts || records.length ? "draft_only" : "empty" };
  });
}

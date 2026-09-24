// First-pass proposal sections from the bid library (docs/plans/phase-5.md part A, item 5). Past performance is
// used only when its case record is marked disclosure authorized. Drafts are for editing, never submitted.
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { bidLibrary, caseRecords, fundingOpportunities } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { validateMessage } from "@/lib/style/validate";

export const zProposal = z.object({
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).min(1).max(8),
  gaps: z.array(z.string()).describe("What Prado must confirm or add before submission"),
});
export type ProposalDraft = z.infer<typeof zProposal> & { draftedAt: string; styleFlags: string[] };

/** Library blocks usable in a proposal: past performance only with an authorized case record. */
export async function usableLibrary(db: Db, mandateId: string) {
  const rows = await db.select({ b: bidLibrary, authorized: caseRecords.disclosureAuthorized }).from(bidLibrary)
    .leftJoin(caseRecords, eq(caseRecords.id, bidLibrary.caseRecordId)).where(eq(bidLibrary.mandateId, mandateId));
  return rows.filter(r => r.b.kind !== "past_performance" || r.authorized === true).map(r => r.b);
}

export async function draftProposal(db: Db, cfg: AiConfig, opportunityId: string, client?: Anthropic): Promise<ProposalDraft> {
  const [o] = await db.select().from(fundingOpportunities).where(eq(fundingOpportunities.id, opportunityId));
  if (!o) throw new Error("Opportunity not found");
  const lib = await usableLibrary(db, o.mandateId);
  const input = [
    `Call: ${o.title}`, `Funder: ${o.funder ?? "unknown"}${o.programme ? ` (${o.programme})` : ""}`, `Deadline: ${o.deadline ?? "not stated"}`,
    `Route: ${o.route ?? "unassessed"}`, `Call text:\n${o.description.slice(0, 5000) || "Only the title is available. Mark the approach as [TO CONFIRM] against the full call documents."}`,
    lib.length ? `Bid library:\n${lib.map(b => `### ${b.kind}: ${b.title}\n${b.body.slice(0, 2500)}`).join("\n\n")}` : "The bid library is empty. Keep sections short and mark all content [TO CONFIRM].",
  ].join("\n\n");
  const out = await runStructured(db, cfg, "bid.draft", input, zProposal, { entity: "funding", entityId: o.id }, client);
  const styleFlags = [...new Set(out.sections.flatMap(s => validateMessage({ subject: s.heading, body: s.body }, { firstTouch: false, advisory: true }).map(i => i.detail)))];
  const draft: ProposalDraft = { ...out, draftedAt: new Date().toISOString(), styleFlags };
  await db.update(fundingOpportunities).set({ read: { ...(o.read ?? {}), proposal: draft }, updatedAt: new Date().toISOString() })
    .where(and(eq(fundingOpportunities.id, o.id)));
  return draft;
}

// First-pass proposal sections from the bid library (docs/plans/phase-5.md part A, item 5; phase 11 §22). Drafts are
// grounded in the call text, the applicant and project records and APPROVED library blocks only. Every section says
// what it rests on: source fact, client-provided fact, draft language or missing evidence. Past performance is used
// only when its case record is marked disclosure authorized. Drafts are for editing, never submitted.
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { bidLibrary, caseRecords, fundingApplications, fundingOpportunities, organizations, projects } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";
import { validateMessage } from "@/lib/style/validate";
import { basisOf } from "./origination";
import { promiseIssues } from "./vocab";

export const zProposal = z.object({
  sections: z.array(z.object({
    heading: z.string(), body: z.string(),
    basis: z.enum(["source_fact", "client_fact", "draft", "missing"]).optional().describe("source_fact: restates the call text; client_fact: from the applicant or project records given; draft: proposed language; missing: evidence the applicant must supply ([TO CONFIRM])"),
  })).min(1).max(8),
  gaps: z.array(z.string()).describe("What the applicant or Regenera must confirm or add before submission: project history, outcomes, metrics, capacity and partners are never invented"),
});
export type ProposalDraft = { sections: { heading: string; body: string; basis: string }[]; gaps: string[]; draftedAt: string; styleFlags: string[] };

/** Library blocks usable in a proposal: approved only; past performance only with an authorized case record. */
export async function usableLibrary(db: Db, mandateId: string) {
  const rows = await db.select({ b: bidLibrary, authorized: caseRecords.disclosureAuthorized }).from(bidLibrary)
    .leftJoin(caseRecords, eq(caseRecords.id, bidLibrary.caseRecordId)).where(eq(bidLibrary.mandateId, mandateId));
  return rows.filter(r => r.b.approved && (r.b.kind !== "past_performance" || r.authorized === true)).map(r => r.b);
}

export async function draftProposal(db: Db, cfg: AiConfig, opportunityId: string, client?: Anthropic, applicationId?: string): Promise<ProposalDraft> {
  const [o] = await db.select().from(fundingOpportunities).where(eq(fundingOpportunities.id, opportunityId));
  if (!o) throw new Error("Opportunity not found");
  const lib = await usableLibrary(db, o.mandateId);
  const [app] = applicationId ? await db.select().from(fundingApplications).where(and(eq(fundingApplications.id, applicationId), eq(fundingApplications.opportunityId, o.id))) : [];
  const [lead] = app?.leadOrgId ? await db.select({ name: organizations.name, description: organizations.description, location: organizations.location, country: organizations.country }).from(organizations).where(eq(organizations.id, app.leadOrgId)) : [];
  const [project] = app?.projectId ? await db.select({ name: projects.name, description: projects.description, stage: projects.stage, country: projects.country }).from(projects).where(eq(projects.id, app.projectId)) : [];
  const input = [
    `Call: ${o.title}`, `Funder: ${o.funder ?? "unknown"}${o.programme ? ` (${o.programme})` : ""}`, `Deadline: ${o.deadline ?? "not stated"}`,
    `Route: ${o.route ?? "unassessed"}`, `Call text (SOURCE FACTS):\n${o.description.slice(0, 5000) || "Only the title is available. Mark the approach as [TO CONFIRM] against the full call documents."}`,
    o.details.objectives?.scoring?.length ? `Scoring criteria (SOURCE FACTS): ${o.details.objectives.scoring.join("; ")}` : "",
    lead ? `Applicant record (CLIENT-PROVIDED FACTS): ${lead.name}; ${[lead.location, lead.country].filter(Boolean).join(", ")}; ${lead.description?.slice(0, 1500) || "no description recorded"}` : "No applicant record: every applicant fact is [TO CONFIRM].",
    project ? `Project record (CLIENT-PROVIDED FACTS): ${project.name}, stage ${project.stage}, ${project.country ?? ""}. ${project.description.slice(0, 1500)}` : "",
    lib.length ? `Approved bid library:\n${lib.map(b => `### ${b.kind}: ${b.title}\n${b.body.slice(0, 2500)}`).join("\n\n")}` : "The approved bid library is empty. Keep sections short and mark all content [TO CONFIRM].",
    "Never invent project history, outcomes, metrics, organizational capacity or partnerships. Never promise an award.",
  ].filter(Boolean).join("\n\n");
  const out = await runStructured(db, cfg, "bid.draft", input, zProposal, { entity: "funding", entityId: o.id }, client);
  const sections = out.sections.map(s => ({ heading: s.heading, body: s.body, basis: basisOf(s) }));
  const styleFlags = [...new Set([
    ...sections.flatMap(s => validateMessage({ subject: s.heading, body: s.body }, { firstTouch: false, advisory: true }).map(i => i.detail)),
    ...sections.flatMap(s => promiseIssues(s.body)),
  ])];
  const draft: ProposalDraft = { sections, gaps: out.gaps, draftedAt: new Date().toISOString(), styleFlags };
  await db.update(fundingOpportunities).set({ read: { ...(o.read ?? {}), proposal: draft }, updatedAt: new Date().toISOString() })
    .where(and(eq(fundingOpportunities.id, o.id)));
  if (app) await db.update(fundingApplications).set({ narrative: sections, updatedAt: new Date().toISOString() }).where(eq(fundingApplications.id, app.id));
  return draft;
}

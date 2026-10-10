// Owner exports (phase 29E): the commercial lifecycle and relationship records of the workspaces the person owns, as
// JSON with one array per table. No secrets, tokens or password hashes are in these tables; mail content, governed
// knowledge and private capital profiles are not part of these exports.
import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  changeRequests, clientRequests, deals, engagementCloseouts, engagementDeliverables, engagementMilestones, engagements, expenses, invoices, offerProposalVersions, offerProposals,
  partnerships, payments, pipelineStageHistory, relationshipIntroductions, relationshipRoles, relationshipStatus, services, timeEntries,
} from "@/db/schema";

export const EXPORT_AREAS = {
  commercial: { label: "Commercial lifecycle", tables: { services, deals, offer_proposals: offerProposals, offer_proposal_versions: offerProposalVersions, engagements, engagement_milestones: engagementMilestones, engagement_deliverables: engagementDeliverables, client_requests: clientRequests, change_requests: changeRequests, engagement_closeouts: engagementCloseouts, invoices, payments, expenses, time_entries: timeEntries, pipeline_stage_history: pipelineStageHistory } },
  relationships: { label: "Relationships and partners", tables: { relationship_roles: relationshipRoles, relationship_status: relationshipStatus, partnerships, relationship_introductions: relationshipIntroductions } },
} as const;
export type ExportArea = keyof typeof EXPORT_AREAS;

export async function exportArea(db: Db, ownerOf: string[], area: ExportArea) {
  const out: Record<string, unknown[]> = {};
  if (!ownerOf.length) return out;
  for (const [name, table] of Object.entries(EXPORT_AREAS[area].tables)) {
    const t = table as unknown as { mandateId: Parameters<typeof inArray>[0] };
    out[name] = await db.select().from(table as never).where(inArray(t.mandateId, ownerOf)) as unknown[];
  }
  return out;
}

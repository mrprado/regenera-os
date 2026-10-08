// Service-layer integrity gate (phase 23): proposals, outreach drafts, origination advancement and capital introductions
// call this. Excluded and human-review projects are refused here, not only shown with a badge.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { policyDecisions } from "@/db/schema";

export class IntegrityBlocked extends Error {}

export async function assertProjectCleared(db: Db, projectId: string | null | undefined, action: string) {
  if (!projectId) return;
  const [d] = await db.select({ state: policyDecisions.state, version: policyDecisions.policyVersion }).from(policyDecisions).where(and(eq(policyDecisions.projectId, projectId), eq(policyDecisions.current, true))).limit(1);
  if (d && (d.state === "excluded" || d.state === "human_review")) {
    throw new IntegrityBlocked(`${action} is blocked: the project's integrity decision is "${d.state.replace(/_/g, " ")}" (policy v${d.version}). An owner must review and override it with a documented reason first.`);
  }
}

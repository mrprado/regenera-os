import { and, eq } from "drizzle-orm";
import { policyDecisions } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { CLASSIFICATION_LABEL, DECISION_STATE_LABEL } from "@/lib/integrity/policy";

// Guarded: a project's current integrity decision for the Atlas inspector (readings and outstanding evidence only).
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  const [d] = await appDb().select().from(policyDecisions).where(and(eq(policyDecisions.projectId, id), eq(policyDecisions.current, true), mandateCondition(user.scope, policyDecisions.mandateId))).limit(1);
  if (!d) return Response.json({ none: true }, { headers: { "cache-control": "private, max-age=60" } });
  return Response.json({
    state: DECISION_STATE_LABEL[d.state], blocking: d.state === "excluded" || d.state === "human_review", classification: CLASSIFICATION_LABEL[d.classification], confidence: d.confidence,
    policyVersion: d.policyVersion, at: d.createdAt.slice(0, 10), readings: d.readings.map(r => ({ label: r.label, value: r.value })), outstanding: d.outstanding.slice(0, 4),
  }, { headers: { "cache-control": "private, max-age=60" } });
}

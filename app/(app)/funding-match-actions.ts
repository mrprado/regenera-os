"use server";

// Accept or dismiss a funding ↔ project match (phase 21 §4). A person decides; accepting records the decision only
// (it does not apply, contact or commit anything).
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fundingProjectMatches } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser, type OsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";

const parse = (formData: FormData) => ({ id: z.string().uuid().parse(formData.get("id")), back: z.string().startsWith("/").catch("/projects").parse(formData.get("back")) });

async function decide(user: OsUser, id: string, status: "accepted" | "dismissed") {
  const r = await appDb().update(fundingProjectMatches).set({ status, decidedBy: user.email, updatedAt: new Date().toISOString() })
    .where(and(eq(fundingProjectMatches.id, id), mandateCondition(user.scope, fundingProjectMatches.mandateId))).returning({ id: fundingProjectMatches.id });
  if (r.length) await audit(appDb(), { actor: user.email, action: `funding_match.${status}`, entity: "funding_project_matches", entityId: id });
}

export async function acceptFundingMatchAction(formData: FormData) {
  const { id, back } = parse(formData);
  await withOsUser(user => decide(user, id, "accepted"));
  redirect(back);
}

export async function dismissFundingMatchAction(formData: FormData) {
  const { id, back } = parse(formData);
  await withOsUser(user => decide(user, id, "dismissed"));
  redirect(back);
}

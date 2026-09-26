"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { contacts, organizations, projects, relationshipEdges } from "@/db/schema";
import { EDGE_TYPES } from "@/db/graph";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";

type Scope = Parameters<typeof mandateCondition>[0];
const zId = z.string().uuid();

/** "p:<id>", "o:<id>" or "prj:<id>" → type and id, checked inside the user's scope. */
async function resolve(scope: Scope, ref: string) {
  const [prefix, id] = ref.split(":");
  zId.parse(id);
  const t = prefix === "p" ? contacts : prefix === "o" ? organizations : prefix === "prj" ? projects : null;
  if (!t) throw new Error("Unknown node");
  const [r] = await appDb().select({ m: t.mandateId }).from(t).where(and(eq(t.id, id), mandateCondition(scope, t.mandateId)));
  if (!r) throw new Error("Not found");
  return { type: (prefix === "p" ? "person" : prefix === "o" ? "organization" : "project") as "person" | "organization" | "project", id, mandateId: r.m };
}

export async function addEdgeAction(formData: FormData) {
  const type = z.enum(EDGE_TYPES).parse(formData.get("type"));
  let back = "/relationships";
  await withOsUser(async user => {
    const from = await resolve(user.scope, String(formData.get("from") ?? ""));
    const to = await resolve(user.scope, String(formData.get("to") ?? ""));
    const strength = Math.max(0.05, Math.min(1, Number(formData.get("strength") ?? 0.5) || 0.5));
    await appDb().insert(relationshipEdges).values({
      mandateId: from.mandateId, fromType: from.type, fromId: from.id, toType: to.type, toId: to.id, type, strength,
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(formData.get("since")).data ?? null,
      note: z.string().trim().max(500).catch("").parse(formData.get("note") ?? ""), createdBy: user.email,
    });
    back = `/relationships?target=${encodeURIComponent(String(formData.get("to")))}`;
  });
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent("Relationship recorded.")}`);
}

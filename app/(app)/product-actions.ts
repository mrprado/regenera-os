"use server";

// Product governance (hardening prompt §29, §77–81). Regenera-internal: ideas, client requests and debt are recorded
// and classified; nothing moves to "accepted" without a build category other than "not yet justified".
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { productItems } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { BUILD_CATEGORIES, PRODUCT_CLASSES, PRODUCT_ITEM_KINDS, PRODUCT_STATUSES } from "@/lib/commercial/vocab";

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const back = (kind: string, text: string) => `/settings/product?kind=${kind}&notice=${encodeURIComponent(text)}`;

export async function addProductItemAction(formData: FormData) {
  const kind = z.enum(keys(PRODUCT_ITEM_KINDS)).parse(formData.get("kind"));
  await withOsUser(async user => {
    const [row] = await appDb().insert(productItems).values({
      mandateId: user.scope.mandateIds[0], kind, title: z.string().trim().min(3).max(200).parse(formData.get("title")),
      problem: str(formData, "problem", 2000), user: str(formData, "user", 200), evidence: str(formData, "evidence", 2000), frequency: str(formData, "frequency", 200),
      revenueRelevance: str(formData, "revenueRelevance", 300), urgency: str(formData, "urgency", 200), workaround: str(formData, "workaround", 1000),
      component: str(formData, "component", 200), impact: str(formData, "impact", 500), effort: str(formData, "effort", 100),
      priority: z.enum(["critical", "high", "medium", "low"]).catch("medium").parse(formData.get("priority")), source: str(formData, "source", 40) || "internal",
      owner: str(formData, "owner", 120) || null, createdBy: user.email,
    }).returning();
    await audit(appDb(), { actor: user.email, action: "product_item_added", entity: "product_items", entityId: row.id, after: { kind, title: row.title } });
  }, { internal: true });
  redirect(back(kind, "Recorded. It is reviewed before anything is built."));
}

export async function reviewProductItemAction(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("itemId"));
  let kind = "request";
  await withOsUser(async user => {
    const [before] = await appDb().select().from(productItems).where(and(eq(productItems.id, id), mandateCondition(user.scope, productItems.mandateId)));
    if (!before) throw new Error("Not found");
    kind = before.kind;
    const buildCategory = z.enum(keys(BUILD_CATEGORIES)).parse(formData.get("buildCategory"));
    const status = z.enum(keys(PRODUCT_STATUSES)).parse(formData.get("status"));
    if ((status === "accepted" || status === "scheduled") && buildCategory === "not_ready") throw new Error("Accept only a bug, depth work or a validated client requirement");
    const patch = { classification: z.enum(keys(PRODUCT_CLASSES)).nullable().catch(null).parse(formData.get("classification") || null), buildCategory, status, decisionNote: str(formData, "decisionNote", 1000), reviewedBy: user.email, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await appDb().update(productItems).set(patch).where(eq(productItems.id, id));
    await audit(appDb(), { actor: user.email, action: "product_item_reviewed", entity: "product_items", entityId: id, before: { status: before.status, buildCategory: before.buildCategory }, after: patch });
  }, { internal: true });
  redirect(back(kind, "Review saved."));
}

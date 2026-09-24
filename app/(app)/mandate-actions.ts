"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { mandates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { MANDATE_COOKIE, withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { addMember, isMandateAdmin, removeMember } from "@/lib/mandates";

const back = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/today";
};

/** Header switcher: one mandate or all. Only mandates the user belongs to take effect (lib/mandates.ts narrowScope). */
export async function setMandateFocusAction(formData: FormData) {
  const focus = z.string().max(80).parse(formData.get("mandate") ?? "all");
  const to = back(formData.get("back"));
  await withOsUser(async user => {
    const jar = await cookies();
    const member = user.scope.memberOf ?? user.scope.mandateIds;
    if (focus === "all" || !member.includes(focus)) jar.delete(MANDATE_COOKIE);
    else jar.set(MANDATE_COOKIE, focus, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 180 });
  });
  redirect(to);
}

function assertAdmin(user: { scope: Parameters<typeof isMandateAdmin>[0] }) {
  if (!isMandateAdmin(user.scope)) throw new Error("Only owners of the Regenera mandate manage mandates");
}

export async function createMandateAction(formData: FormData) {
  const name = z.string().trim().min(2).max(80).parse(formData.get("name"));
  const type = z.enum(["advisory", "investment", "development"]).parse(formData.get("type"));
  const slug = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  await withOsUser(async user => {
    assertAdmin(user);
    const actor = user.email;
    const id = `mandate_${slug.replace(/-/g, "_")}`;
    await appDb().insert(mandates).values({ id, slug, name, type, rules: { massAllowed: type !== "investment", approvalRequired: true } }).onConflictDoNothing();
    await audit(appDb(), { actor, action: "mandate_create", entity: "mandates", entityId: id, after: { name, type } });
  });
  redirect("/settings/mandates");
}

export async function updateMandateAction(formData: FormData) {
  const id = z.string().min(3).max(80).parse(formData.get("id"));
  const sendingIdentity = z.string().trim().max(200).parse(formData.get("sendingIdentity") ?? "");
  const feeTerms = z.string().trim().max(1000).parse(formData.get("feeTerms") ?? "");
  await withOsUser(async user => {
    assertAdmin(user);
    const actor = user.email;
    const db = appDb();
    const [m] = await db.select().from(mandates).where(eq(mandates.id, id));
    if (!m) throw new Error("Mandate not found");
    // Investment mandates never allow the mass tier, whatever is submitted.
    const massAllowed = m.type === "investment" ? false : formData.get("massAllowed") === "on";
    await db.update(mandates).set({ sendingIdentity, feeTerms, rules: { ...m.rules, massAllowed }, updatedAt: new Date().toISOString() }).where(eq(mandates.id, id));
    await audit(db, { actor, action: "mandate_update", entity: "mandates", entityId: id, before: { sendingIdentity: m.sendingIdentity, feeTerms: m.feeTerms, rules: m.rules }, after: { sendingIdentity, feeTerms, massAllowed } });
  });
  redirect(`/settings/mandates?notice=${encodeURIComponent("Saved.")}`);
}

export async function counselAction(formData: FormData) {
  const id = z.string().min(3).max(80).parse(formData.get("id"));
  const confirm = formData.get("confirm") === "1";
  await withOsUser(async user => {
    assertAdmin(user);
    const actor = user.email;
    const now = new Date().toISOString();
    await appDb().update(mandates).set(confirm ? { counselConfirmedAt: now, counselConfirmedBy: actor, updatedAt: now } : { counselConfirmedAt: null, counselConfirmedBy: null, updatedAt: now }).where(eq(mandates.id, id));
    await audit(appDb(), { actor, action: confirm ? "mandate_counsel_confirmed" : "mandate_counsel_withdrawn", entity: "mandates", entityId: id });
  });
  redirect("/settings/mandates");
}

export async function memberAction(formData: FormData) {
  const id = z.string().min(3).max(80).parse(formData.get("id"));
  const email = z.string().trim().toLowerCase().email().parse(formData.get("email"));
  const op = z.enum(["add", "remove"]).parse(formData.get("op"));
  const role = z.enum(["owner", "member"]).catch("member").parse(formData.get("role"));
  let notice = "";
  await withOsUser(async user => {
    assertAdmin(user);
    const actor = user.email;
    if (op === "add") { await addMember(appDb(), id, email, role); notice = `Added ${email} as ${role}.`; }
    else notice = (await removeMember(appDb(), id, email)) ? `Removed ${email}.` : "The Regenera mandate must keep at least one owner.";
    await audit(appDb(), { actor, action: `mandate_member_${op}`, entity: "mandate_members", entityId: id, after: { email, role } });
  });
  redirect(`/settings/mandates?notice=${encodeURIComponent(notice)}`);
}

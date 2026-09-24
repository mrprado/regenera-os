"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { caseRecords } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { confirmProposal, rejectProposal } from "@/lib/ask/execute";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { enqueue } from "@/lib/jobs/queue";
import { erasePerson } from "@/lib/privacy";

const zId = z.string().uuid();
const safeBack = (v: FormDataEntryValue | null, fallback: string) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
};
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

export async function confirmProposalAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const back = safeBack(formData.get("back"), "/today");
  let text = "";
  await withOsUser(async user => {
    const r = await confirmProposal(appDb(), user.scope, user.email, id);
    text = r.ok ? "Done." : r.error;
  });
  redirect(note(back, text));
}

export async function rejectProposalAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const reason = z.string().trim().max(300).parse(formData.get("reason") ?? "") || "Not now";
  const back = safeBack(formData.get("back"), "/today");
  await withOsUser(async user => {
    await rejectProposal(appDb(), user.scope, user.email, id, reason);
  });
  redirect(back);
}

export async function runLearningNowAction() {
  await withOsUser(async user => {
    await enqueue(appDb(), "learning.monthly", {}, { dedupeKey: `learning:manual:${new Date().toISOString().slice(0, 13)}` });
    await audit(appDb(), { actor: user.email, action: "learning_requested", entity: "proposals" });
  }, { owner: true });
  redirect(note("/reports?tab=learning", "The learning review is queued and runs on the next job tick."));
}

export async function saveCaseAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const decision = z.string().max(2000).parse(formData.get("decision") ?? "");
  const outcome = z.string().max(2000).parse(formData.get("outcome") ?? "");
  const evidence = z.string().max(2000).parse(formData.get("evidence") ?? "");
  const disclosureAuthorized = formData.get("disclosure") === "on";
  await withOsUser(async user => {
    const [c] = await appDb().update(caseRecords).set({ decision, outcome, evidence, disclosureAuthorized, updatedAt: new Date().toISOString() })
      .where(and(eq(caseRecords.id, id), mandateCondition(user.scope, caseRecords.mandateId))).returning({ id: caseRecords.id });
    if (!c) throw new Error("Case record not found");
    await audit(appDb(), { actor: user.email, action: "case_record_saved", entity: "case_records", entityId: id, after: { disclosureAuthorized } });
  });
  redirect(note("/reports?tab=cases", "Saved."));
}

/** Erasure request (owner only): the person must be typed as ERASE to confirm. Irreversible. */
export async function erasePersonAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "ERASE") redirect(`/people/${id}?notice=${encodeURIComponent("Type ERASE to confirm the erasure.")}`);
  let text = "";
  await withOsUser(async user => {
    const r = await erasePerson(appDb(), user.scope.ownerOf, id, user.email);
    if (!r) throw new Error("Person not found in a mandate you own");
    await audit(appDb(), { actor: user.email, action: "privacy_erasure", entity: "contacts", entityId: id, after: r });
    text = `Erased. ${r.messages} messages and ${r.replies} replies deleted, ${r.activities} activities anonymized. The address is kept only as a hash so they are never emailed again.`;
  }, { owner: true });
  redirect(`/people?notice=${encodeURIComponent(text)}`);
}

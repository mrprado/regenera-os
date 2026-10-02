"use server";

// Email intelligence actions (docs/plans/phase-13-mail-intelligence.md). Owner only; nothing here writes to Gmail.
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { resolveReview, setObligationStatus } from "@/lib/mail-intel/queries";

const zId = z.string().uuid();

export async function obligationDoneAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await setObligationStatus(appDb(), user.scope, id, "done"); await audit(appDb(), { actor: user.email, action: "mail.obligation_done", entity: "mail_obligation", entityId: id }); }, { owner: true });
  redirect("/intelligence/mail?tab=obligations");
}

export async function obligationDropAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await setObligationStatus(appDb(), user.scope, id, "dropped"); await audit(appDb(), { actor: user.email, action: "mail.obligation_dropped", entity: "mail_obligation", entityId: id }); }, { owner: true });
  redirect("/intelligence/mail?tab=obligations");
}

export async function reviewAcceptAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await resolveReview(appDb(), user.scope, id, "accepted"); await audit(appDb(), { actor: user.email, action: "mail.review_accepted", entity: "mail_review", entityId: id }); }, { owner: true });
  redirect("/intelligence/mail?tab=review");
}

export async function reviewRejectAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => { await resolveReview(appDb(), user.scope, id, "rejected"); await audit(appDb(), { actor: user.email, action: "mail.review_rejected", entity: "mail_review", entityId: id }); }, { owner: true });
  redirect("/intelligence/mail?tab=review");
}

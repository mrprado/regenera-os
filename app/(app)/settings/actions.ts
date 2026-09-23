"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { mandateMembers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { getAccessToken } from "@/lib/google/accounts";
import { googleConfig } from "@/lib/google/config";
import { buildRawMessage, gmailSend } from "@/lib/google/gmail";
import { zMailboxRole } from "@/lib/google/oauth";
import { retryDead } from "@/lib/jobs/queue";
import { tick } from "@/lib/jobs/tick";

export async function runJobsNow() {
  await withOsUser(async user => {
    const result = await tick(appDb(), { budgetMs: 20_000 });
    await audit(appDb(), { actor: user.email, action: "manual_tick", entity: "jobs", after: result });
  }, { owner: true });
  redirect("/settings/jobs?ran=1");
}

export async function retryJob(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  await withOsUser(async user => {
    await retryDead(appDb(), id, new Date());
    await audit(appDb(), { actor: user.email, action: "retry_job", entity: "jobs", entityId: id });
  }, { owner: true });
  redirect("/settings/jobs");
}

export async function addMember(formData: FormData) {
  const email = z.string().trim().toLowerCase().email().max(180).safeParse(formData.get("email"));
  if (!email.success) redirect("/settings/members?error=email");
  await withOsUser(async user => {
    const mandateId = user.scope.ownerOf[0];
    await appDb().insert(mandateMembers).values({ mandateId, email: email.data, role: "member" }).onConflictDoNothing();
    await audit(appDb(), { actor: user.email, action: "add_member", entity: "mandate_members", entityId: mandateId, after: { email: email.data } });
  }, { owner: true });
  redirect("/settings/members?added=1");
}

export async function removeMember(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  await withOsUser(async user => {
    // Owners cannot be removed here, and only from mandates the actor owns.
    const [row] = await appDb().select().from(mandateMembers).where(eq(mandateMembers.id, id));
    if (!row || row.role === "owner" || !user.scope.ownerOf.includes(row.mandateId)) throw new Error("Not allowed");
    await appDb().delete(mandateMembers).where(and(eq(mandateMembers.id, id), eq(mandateMembers.role, "member")));
    await audit(appDb(), { actor: user.email, action: "remove_member", entity: "mandate_members", entityId: row.mandateId, before: { email: row.email } });
  }, { owner: true });
  redirect("/settings/members");
}

/** Sends a test email from a connected mailbox to that same mailbox. Never to a contact. */
export async function sendTestEmail(formData: FormData) {
  const mailbox = zMailboxRole.parse(formData.get("mailbox"));
  const cfg = googleConfig();
  if (!cfg) redirect("/settings/connections?test=not_configured");
  let outcome = "sent";
  await withOsUser(async user => {
    try {
      const { accessToken, email } = await getAccessToken(appDb(), cfg, mailbox);
      const raw = buildRawMessage({
        from: email,
        to: email,
        subject: "Regenera OS test",
        text: `This is a test message from Regenera OS, sent from the ${mailbox} mailbox to itself.\nRequested by ${user.email} at ${new Date().toISOString()}.`,
      });
      const sent = await gmailSend(accessToken, raw);
      await audit(appDb(), { actor: user.email, action: "test_email_sent", entity: "oauth_accounts", entityId: mailbox, after: { gmailId: sent.id } });
    } catch (error) {
      console.error("Test email failed", error);
      outcome = "error";
    }
  }, { owner: true });
  redirect(`/settings/connections?test=${outcome}`);
}

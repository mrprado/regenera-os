"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CONTRACT_KINDS, contractMilestones, contracts, deals, partners, type ContractTerms } from "@/db/schema";
import { withOsUser } from "@/lib/auth";
import {
  addMilestone, closeContract, createContract, markSent, markSigned, recordCounselReview, regenerateBody, scheduleRetainer, setMilestoneStatus, updateContract,
} from "@/lib/contracts/engine";
import { appDb, mandateCondition } from "@/lib/db/scoped";

const zId = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const optNum = (f: FormData, k: string) => { const n = Number(str(f, k).replace(/[^0-9.]/g, "")); return str(f, k) && Number.isFinite(n) ? n : null; };
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

async function scopedContract(scope: Parameters<typeof mandateCondition>[0], id: string) {
  const [c] = await appDb().select().from(contracts).where(and(eq(contracts.id, id), mandateCondition(scope, contracts.mandateId)));
  if (!c) throw new Error("Contract not found");
  return c;
}

export async function createContractAction(formData: FormData) {
  const kind = z.enum(CONTRACT_KINDS).parse(formData.get("kind"));
  const source = str(formData, "source");
  let target = "/contracts";
  await withOsUser(async user => {
    const [type, rawId] = source.split(":");
    const sourceId = zId.parse(rawId);
    let mandateId: string | undefined;
    if (type === "partner") {
      [{ mandateId } = { mandateId: undefined }] = await appDb().select({ mandateId: partners.mandateId }).from(partners).where(and(eq(partners.id, sourceId), mandateCondition(user.scope, partners.mandateId)));
    } else {
      [{ mandateId } = { mandateId: undefined }] = await appDb().select({ mandateId: deals.mandateId }).from(deals).where(and(eq(deals.id, sourceId), mandateCondition(user.scope, deals.mandateId)));
    }
    if (!mandateId) { target = note("/contracts", "Pick a deal (or a partner for a referral agreement)."); return; }
    if ((type === "partner") !== (kind === "referral_agreement")) { target = note("/contracts", "Referral agreements are drafted from a partner; every other contract from a deal."); return; }
    const row = await createContract(appDb(), { mandateId, kind, dealId: type === "deal" ? sourceId : null, partnerId: type === "partner" ? sourceId : null, actor: user.email });
    target = note(`/contracts/${row.id}`, "Draft created from the template. Fill every [TO CONFIRM] and have counsel review before sending.");
  });
  redirect(target);
}

export async function saveContractAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Saved.";
  await withOsUser(async user => {
    const c = await scopedContract(user.scope, id);
    const terms: ContractTerms = {
      ...c.terms,
      currency: str(formData, "currency", 8).toUpperCase() || c.terms.currency,
      feeSummary: str(formData, "feeSummary", 1000) || c.terms.feeSummary,
      paymentDays: optNum(formData, "paymentDays") ?? c.terms.paymentDays,
      termMonths: optNum(formData, "termMonths"),
      noticeDays: optNum(formData, "noticeDays") ?? c.terms.noticeDays,
      autoRenew: formData.get("autoRenew") === "on",
      governingLaw: str(formData, "governingLaw", 120) || c.terms.governingLaw,
      counterparty: {
        name: str(formData, "cpName", 200) || c.terms.counterparty.name, address: str(formData, "cpAddress", 300),
        signatoryName: str(formData, "cpSignatory", 120), signatoryTitle: str(formData, "cpTitle", 120), signatoryEmail: str(formData, "cpEmail", 200),
      },
      regenera: { signatoryName: str(formData, "rgSignatory", 120) || c.terms.regenera.signatoryName, signatoryTitle: str(formData, "rgTitle", 120) || c.terms.regenera.signatoryTitle },
    };
    const signedCopyUrl = str(formData, "signedCopyUrl", 500);
    try {
      const v = await updateContract(appDb(), id, {
        title: str(formData, "title", 200) || c.title, body: c.status === "draft" ? str(formData, "body", 60_000) || c.body : undefined,
        terms: c.status === "draft" ? terms : undefined, value: optNum(formData, "value"),
        signedCopyUrl: signedCopyUrl ? z.string().url().catch("").parse(signedCopyUrl) || c.signedCopyUrl : c.signedCopyUrl,
      }, user.email, str(formData, "note", 200));
      msg = v !== c.version ? `Saved as version ${v}.` : "Saved.";
    } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${id}`, msg));
}

export async function regenerateContractAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "";
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    try { msg = `Rebuilt from the template as version ${await regenerateBody(appDb(), id, user.email)}. The previous text is kept in the history.`; } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${id}`, msg));
}

export async function counselReviewAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    await recordCounselReview(appDb(), id, user.email);
  }, { owner: true });
  redirect(note(`/contracts/${id}`, "Counsel review recorded."));
}

export async function markSentAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "Marked sent. The deal moved to Proposal if it was earlier.";
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    try { await markSent(appDb(), id, user.email); } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${id}`, msg));
}

export async function markSignedAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const signedAt = zDate.parse(formData.get("signedAt"));
  const effectiveDate = zDate.safeParse(formData.get("effectiveDate")).data ?? null;
  const url = z.string().url().safeParse(str(formData, "signedCopyUrl", 500)).data ?? null;
  let msg = "";
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    try {
      const r = await markSigned(appDb(), id, { signedAt, effectiveDate, signedCopyUrl: url }, user.email);
      msg = `Signed. Effective ${r.effectiveDate}${r.endDate ? `, ends ${r.endDate}` : ""}. The deal moved to Signed.`;
    } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${id}`, msg));
}

export async function closeContractAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const to = z.enum(["completed", "terminated"]).parse(formData.get("to"));
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    await closeContract(appDb(), id, to, user.email);
  });
  redirect(note(`/contracts/${id}`, to === "completed" ? "Marked completed." : "Marked terminated."));
}

export async function addMilestoneAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const title = z.string().trim().min(1).max(200).parse(formData.get("title"));
  const dueDate = zDate.safeParse(formData.get("dueDate")).data ?? null;
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    await addMilestone(appDb(), id, { title, dueDate, amount: optNum(formData, "amount") });
  });
  redirect(note(`/contracts/${id}`, "Milestone added."));
}

export async function scheduleRetainerAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const monthly = z.coerce.number().positive().parse(formData.get("monthly"));
  let msg = "";
  await withOsUser(async user => {
    await scopedContract(user.scope, id);
    try { msg = `${await scheduleRetainer(appDb(), id, monthly)} monthly milestones added.`; } catch (e) { msg = errorText(e); }
  });
  redirect(note(`/contracts/${id}`, msg));
}

export async function milestoneStatusAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  const status = z.enum(["pending", "invoiced", "paid", "waived"]).parse(formData.get("status"));
  let contractId = "";
  await withOsUser(async user => {
    const [m] = await appDb().select({ contractId: contractMilestones.contractId }).from(contractMilestones)
      .where(and(eq(contractMilestones.id, id), mandateCondition(user.scope, contractMilestones.mandateId)));
    if (!m) throw new Error("Milestone not found");
    contractId = m.contractId;
    await setMilestoneStatus(appDb(), id, status);
  });
  redirect(note(`/contracts/${contractId}`, `Milestone marked ${status}.`));
}

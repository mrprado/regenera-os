// Payments (phase 29A). An invoice's paid amount and status are derived from payment rows, each with evidence (bank
// reference, remittance advice or a verified provider event). A provider payment id is recorded once: a repeated
// webhook or a second click returns the existing row. A browser redirect is never evidence of payment. No payment
// provider is configured; manual reconciliation with evidence is the supported path.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { invoices, payments } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { PAYMENT_KINDS, PAYMENT_METHODS } from "./vocab";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type PaymentInput = {
  invoiceId: string; amount: number; currency?: string; kind?: keyof typeof PAYMENT_KINDS; method?: keyof typeof PAYMENT_METHODS;
  receivedOn: string; evidence: string; provider?: string; providerPaymentId?: string | null; note?: string;
};

export async function recordInvoicePayment(db: Db, input: PaymentInput, by: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "void" || inv.status === "draft" || inv.status === "scheduled") throw new Error("Issue the invoice before recording a payment.");
  const provider = input.provider ?? "manual";
  if (input.providerPaymentId) {
    const [dup] = await db.select().from(payments).where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, input.providerPaymentId)));
    if (dup) return { payment: dup, duplicate: true };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter the amount received (refunds and credits are recorded as their own kind).");
  if (!input.evidence.trim()) throw new Error("Record the evidence: bank reference, remittance advice or provider event.");
  const currency = input.currency ?? inv.currency;
  if (currency !== inv.currency) throw new Error(`The invoice is in ${inv.currency}; record the amount received in ${inv.currency} and note any conversion.`);
  const kind = input.kind ?? "payment";
  const signed = kind === "payment" ? input.amount : -input.amount;
  const paidSoFar = await paidOn(db, inv.id);
  if (kind === "payment" && paidSoFar + signed > inv.amount + 0.005) throw new Error(`This would exceed the invoice (${inv.amount} ${inv.currency}, ${paidSoFar} already received).`);
  if (kind !== "payment" && paidSoFar + signed < -0.005) throw new Error("A refund or credit cannot exceed what was received.");
  const [p] = await db.insert(payments).values({ mandateId: inv.mandateId, invoiceId: inv.id, kind, amount: signed, currency, method: input.method ?? "bank_transfer", receivedOn: input.receivedOn, evidence: input.evidence, provider, providerPaymentId: input.providerPaymentId ?? null, note: input.note ?? "", recordedBy: by })
    .onConflictDoNothing().returning();
  if (!p) { const [dup] = await db.select().from(payments).where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, input.providerPaymentId!))); return { payment: dup, duplicate: true }; }
  await syncInvoice(db, inv.id);
  await audit(db, { actor: by, action: "payment_recorded", entity: "invoices", entityId: inv.id, after: { kind, amount: signed, currency, provider } });
  return { payment: p, duplicate: false };
}

export async function paidOn(db: Db, invoiceId: string) {
  const [x] = await db.select({ s: sql<number>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(eq(payments.invoiceId, invoiceId));
  return r2(Number(x?.s ?? 0));
}

/** Paid amount and status from the payment rows. */
export async function syncInvoice(db: Db, invoiceId: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return;
  const paid = await paidOn(db, invoiceId);
  const rows = await db.select({ receivedOn: payments.receivedOn }).from(payments).where(and(eq(payments.invoiceId, invoiceId), eq(payments.kind, "payment")));
  const full = paid >= inv.amount - 0.005;
  const status = full ? "paid" : paid > 0 ? "partially_paid" : inv.status === "paid" || inv.status === "partially_paid" ? "sent" : inv.status;
  await db.update(invoices).set({ paidAmount: paid, paidAt: full ? rows.map(r => r.receivedOn).sort().at(-1) ?? null : null, status, updatedAt: new Date().toISOString() }).where(eq(invoices.id, invoiceId));
}

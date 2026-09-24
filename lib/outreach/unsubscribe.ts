// Signed unsubscribe tokens (SPEC section 22). The token carries the message id and address, so the
// anonymous route can suppress without a lookup table and cannot be forged or replayed for another address.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, enrollments, messages, suppression } from "@/db/schema";
import { fromBase64Url, hmac, safeEqual, toBase64Url } from "@/lib/crypto";

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function signUnsubscribeToken(secret: string, messageId: string, email: string): Promise<string> {
  const payload = toBase64Url(enc.encode(JSON.stringify({ m: messageId, e: email.toLowerCase() })));
  return `${payload}.${await hmac(secret, "unsubscribe", payload)}`;
}

export async function verifyUnsubscribeToken(secret: string, token: string): Promise<{ messageId: string; email: string } | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(sig, await hmac(secret, "unsubscribe", payload))) return null;
  try {
    const { m, e } = JSON.parse(dec.decode(fromBase64Url(payload))) as { m?: string; e?: string };
    return typeof m === "string" && typeof e === "string" ? { messageId: m, email: e } : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/unsubscribe/${token}`;
}

/** Idempotent: suppresses the address, stops enrollments, logs once. */
export async function applyUnsubscribe(db: Db, v: { messageId: string; email: string }) {
  await db.insert(suppression).values({ email: v.email, reason: "unsubscribe" }).onConflictDoNothing();
  const [c] = await db.select().from(contacts).where(eq(contacts.emailLower, v.email)).limit(1);
  if (!c || c.suppressed) return;
  const now = new Date().toISOString();
  await db.update(contacts).set({ suppressed: true, updatedAt: now }).where(eq(contacts.id, c.id));
  await db.update(enrollments).set({ status: "stopped", stopReason: "unsubscribed", updatedAt: now }).where(and(eq(enrollments.contactId, c.id), inArray(enrollments.status, ["drafting", "active", "paused"])));
  await db.update(messages).set({ status: "cancelled", updatedAt: now }).where(and(eq(messages.contactId, c.id), inArray(messages.status, ["draft", "style_failed", "pending_approval", "approved"])));
  await db.insert(activities).values({ mandateId: c.mandateId, contactId: c.id, orgId: c.orgId, type: "note", method: "system", detail: "Unsubscribed via email link", source: "job", actor: "system" });
}

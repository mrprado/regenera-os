// Pinned items (phase 25): resolve a record within the user's scope, list a user's pins with current names, and drop
// pins the user can no longer open. Every function takes a Db so it is testable against local D1.
import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import {
  analysisRequests, capitalProfiles, commercialMandates, contacts, contracts, deals, engagements, fundingApplications, fundingOpportunities, objectives,
  organizations, pinnedItems, projects, pursuits, scanRuns,
} from "@/db/schema";
import { mandateCondition, type Scope } from "@/lib/db/scoped";
import { pathAllowed } from "@/lib/tenancy/vocab";
import { MAX_PINS, pinHref, type PinType } from "./vocab";

type Source = { table: SQLiteTable; id: SQLiteColumn; label: SQLiteColumn; mandate: SQLiteColumn; extra?: SQL };
const SOURCES: Record<PinType, Source> = {
  project: { table: projects, id: projects.id, label: projects.name, mandate: projects.mandateId, extra: isNull(projects.archivedAt) },
  deal: { table: deals, id: deals.id, label: deals.name, mandate: deals.mandateId, extra: isNull(deals.archivedAt) },
  funding_opportunity: { table: fundingOpportunities, id: fundingOpportunities.id, label: fundingOpportunities.title, mandate: fundingOpportunities.mandateId },
  funding_application: { table: fundingApplications, id: fundingApplications.id, label: fundingApplications.name, mandate: fundingApplications.mandateId },
  analysis: { table: analysisRequests, id: analysisRequests.id, label: analysisRequests.question, mandate: analysisRequests.mandateId },
  scan_run: { table: scanRuns, id: scanRuns.id, label: scanRuns.presetName, mandate: scanRuns.mandateId },
  objective: { table: objectives, id: objectives.id, label: objectives.title, mandate: objectives.mandateId },
  organization: { table: organizations, id: organizations.id, label: organizations.name, mandate: organizations.mandateId, extra: isNull(organizations.archivedAt) },
  contact: { table: contacts, id: contacts.id, label: contacts.fullName, mandate: contacts.mandateId, extra: isNull(contacts.archivedAt) },
  capital_profile: { table: capitalProfiles, id: capitalProfiles.id, label: capitalProfiles.name, mandate: capitalProfiles.mandateId },
  contract: { table: contracts, id: contracts.id, label: contracts.title, mandate: contracts.mandateId },
  commercial_mandate: { table: commercialMandates, id: commercialMandates.id, label: commercialMandates.name, mandate: commercialMandates.mandateId },
  pursuit: { table: pursuits, id: pursuits.id, label: pursuits.name, mandate: pursuits.mandateId },
  engagement: { table: engagements, id: engagements.id, label: engagements.name, mandate: engagements.mandateId },
};

const canOpen = (scope: Scope, type: PinType, id: string) => scope.kind === "system" || pathAllowed(scope.modules, pinHref(type, id));

/** The record's current name and workspace, or null when this user may not open it (other workspace, module, archived). */
export async function resolvePin(db: Db, scope: Scope, type: PinType, id: string): Promise<{ label: string; mandateId: string } | null> {
  if (!canOpen(scope, type, id)) return null;
  const s = SOURCES[type];
  const [row] = await db.select({ label: s.label, mandateId: s.mandate }).from(s.table).where(and(eq(s.id, id), mandateCondition(scope, s.mandate), s.extra)).limit(1);
  return row ? { label: String(row.label ?? "Untitled").trim() || "Untitled", mandateId: String(row.mandateId) } : null;
}

export type Pin = { id: string; type: PinType; entityId: string; label: string; href: string };

/** The user's pins in order with current names. Pins the user can no longer open are deleted and counted. */
export async function listPins(db: Db, scope: Scope, email: string): Promise<{ pins: Pin[]; removed: number }> {
  const rows = await db.select().from(pinnedItems).where(eq(pinnedItems.userEmail, email)).orderBy(asc(pinnedItems.position), asc(pinnedItems.createdAt)).limit(MAX_PINS + 4);
  if (!rows.length) return { pins: [], removed: 0 };
  const byType = new Map<PinType, string[]>();
  for (const r of rows) byType.set(r.entityType, [...(byType.get(r.entityType) ?? []), r.entityId]);
  const names = new Map<string, string>();
  await Promise.all([...byType].map(async ([type, ids]) => {
    const s = SOURCES[type];
    const found = await db.select({ id: s.id, label: s.label }).from(s.table).where(and(inArray(s.id, ids), mandateCondition(scope, s.mandate), s.extra));
    for (const f of found) if (canOpen(scope, type, String(f.id))) names.set(`${type}:${f.id}`, String(f.label ?? "Untitled").trim() || "Untitled");
  }));
  const gone = rows.filter(r => !names.has(`${r.entityType}:${r.entityId}`));
  if (gone.length) await db.delete(pinnedItems).where(and(eq(pinnedItems.userEmail, email), inArray(pinnedItems.id, gone.map(g => g.id))));
  const pins = rows.filter(r => names.has(`${r.entityType}:${r.entityId}`)).slice(0, MAX_PINS)
    .map(r => ({ id: r.id, type: r.entityType, entityId: r.entityId, label: names.get(`${r.entityType}:${r.entityId}`)!, href: r.href }));
  return { pins, removed: gone.length };
}

export type PinResult = { ok: true } | { ok: false; reason: "not_found" | "full" };

/** Pins a record for this user. At the limit, replaceId names the pin to drop; without it the result is "full". */
export async function pinRecord(db: Db, scope: Scope, email: string, type: PinType, entityId: string, replaceId?: string): Promise<PinResult> {
  const rec = await resolvePin(db, scope, type, entityId);
  if (!rec) return { ok: false, reason: "not_found" };
  const existing = await db.select({ id: pinnedItems.id, entityType: pinnedItems.entityType, entityId: pinnedItems.entityId, position: pinnedItems.position }).from(pinnedItems).where(eq(pinnedItems.userEmail, email));
  if (existing.some(e => e.entityType === type && e.entityId === entityId)) return { ok: true };
  if (existing.length >= MAX_PINS) {
    if (!replaceId || !existing.some(e => e.id === replaceId)) return { ok: false, reason: "full" };
    await db.delete(pinnedItems).where(and(eq(pinnedItems.userEmail, email), eq(pinnedItems.id, replaceId)));
  }
  const position = Math.max(-1, ...existing.filter(e => e.id !== replaceId).map(e => e.position)) + 1;
  await db.insert(pinnedItems).values({ userEmail: email, mandateId: rec.mandateId, entityType: type, entityId, label: rec.label.slice(0, 200), href: pinHref(type, entityId), position })
    .onConflictDoNothing();
  return { ok: true };
}

export async function unpin(db: Db, email: string, pinId: string) {
  await db.delete(pinnedItems).where(and(eq(pinnedItems.userEmail, email), eq(pinnedItems.id, pinId)));
}

/** Saves a new order; ids not belonging to this user are ignored. */
export async function reorderPins(db: Db, email: string, order: string[]) {
  const mine = new Set((await db.select({ id: pinnedItems.id }).from(pinnedItems).where(eq(pinnedItems.userEmail, email))).map(r => r.id));
  const ids = order.filter(id => mine.has(id));
  for (const [i, id] of ids.entries()) await db.update(pinnedItems).set({ position: i }).where(and(eq(pinnedItems.userEmail, email), eq(pinnedItems.id, id)));
}

// "Pursue" (docs/plans/phase-3.md item 1): trigger -> free Apollo people search at that organization ->
// conflict check -> save the people Prado picks -> address (Apollo credit only if chosen, else free inference)
// -> enroll in a sequence. The trigger becomes "pursued".
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, contacts, organizations, triggers } from "@/db/schema";
import { checkConflicts, type Conflict } from "@/lib/crm/conflicts";
import { enrichContactWithApollo, inferContactEmail } from "@/lib/crm/contact-email";
import { upsertContact } from "@/lib/crm/entities";
import { enrollContacts, type EnrollOutcome } from "@/lib/outreach/sequences";
import { type ApolloConfig, type ApolloPerson, searchPeople } from "@/lib/sources/apollo";

const DECISION_SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director"];

export function suggestedTitles(t: { suggestedEngagement: string | null }): string[] {
  try {
    const s = t.suggestedEngagement ? (JSON.parse(t.suggestedEngagement) as { titles?: unknown }) : {};
    return Array.isArray(s.titles) ? s.titles.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export type TriggerPeople = {
  trigger: typeof triggers.$inferSelect;
  org: typeof organizations.$inferSelect;
  people: (ApolloPerson & { inCrm: string | null })[];
  conflicts: Conflict[];
  searchedBy: "titles" | "seniority";
};

/** Free (0 credits). Falls back from the trigger's suggested titles to decision-maker seniority. */
export async function findPeopleForTrigger(db: Db, cfg: ApolloConfig, triggerId: string, fetchImpl?: typeof fetch): Promise<TriggerPeople | null> {
  const [trigger] = await db.select().from(triggers).where(eq(triggers.id, triggerId));
  if (!trigger) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, trigger.orgId));
  if (!org) return null;
  const base = org.domain ? { q_organization_domains_list: [org.domain] } : { q_keywords: org.name };
  const titles = suggestedTitles(trigger);
  let searchedBy: TriggerPeople["searchedBy"] = "titles";
  let res = titles.length ? await searchPeople(db, cfg, { ...base, person_titles: titles, include_similar_titles: true, per_page: 25 }, fetchImpl) : null;
  if (!res || res.people.length === 0) {
    searchedBy = "seniority";
    res = await searchPeople(db, cfg, { ...base, person_seniorities: DECISION_SENIORITIES, per_page: 25 }, fetchImpl);
  }
  const ids = res.people.map(p => p.id);
  const known = ids.length ? await db.select({ id: contacts.id, apolloId: contacts.apolloPersonId }).from(contacts)
    .where(and(eq(contacts.mandateId, trigger.mandateId), inArray(contacts.apolloPersonId, ids))) : [];
  const conflicts = await checkConflicts(db, trigger.mandateId, { orgId: org.id });
  return { trigger, org, people: res.people.map(p => ({ ...p, inCrm: known.find(k => k.apolloId === p.id)?.id ?? null })), conflicts, searchedBy };
}

export type PursueInput = {
  triggerId: string;
  people: { id: string; first_name?: string | null; last_name?: string | null; name?: string | null; title?: string | null; seniority?: string | null; linkedin_url?: string | null; city?: string | null; country?: string | null }[];
  sequenceId: string | null;
  apolloEnrich: boolean;
  overrideConflicts: boolean;
  actor: string;
};

export type PursueResult = {
  saved: number; emails: number; credits: number; conflicts: Conflict[]; blocked: boolean;
  enrolled: EnrollOutcome | null; errors: string[];
};

export async function pursueTrigger(db: Db, apollo: ApolloConfig | null, input: PursueInput, fetchImpl?: typeof fetch): Promise<PursueResult> {
  const [trigger] = await db.select().from(triggers).where(eq(triggers.id, input.triggerId));
  if (!trigger) throw new Error("Trigger not found");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, trigger.orgId));
  const out: PursueResult = { saved: 0, emails: 0, credits: 0, conflicts: [], blocked: false, enrolled: null, errors: [] };
  const contactIds: string[] = [];
  for (const p of input.people) {
    const fullName = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown";
    const c = await upsertContact(db, trigger.mandateId, {
      fullName, firstName: p.first_name, lastName: p.last_name, title: p.title, seniority: p.seniority, linkedinUrl: p.linkedin_url,
      location: [p.city, p.country].filter(Boolean).join(", ") || null, country: p.country ?? org?.country ?? null, apolloPersonId: p.id, orgId: trigger.orgId,
      segmentId: org?.segmentId ?? null,
    }, "trigger", { source: "apollo" });
    if (!c.row.sourceTriggerId) await db.update(contacts).set({ sourceTriggerId: trigger.id }).where(eq(contacts.id, c.row.id));
    contactIds.push(c.row.id);
    out.saved++;
  }
  // Addresses: Apollo only when chosen (credits); otherwise the free pattern inference.
  for (const id of contactIds) {
    const [c] = await db.select({ email: contacts.emailLower }).from(contacts).where(eq(contacts.id, id));
    if (c?.email) { out.emails++; continue; }
    if (input.apolloEnrich) {
      const r = await enrichContactWithApollo(db, apollo, id, fetchImpl);
      if (r.ok) { out.credits += r.credits; if (r.email) { out.emails++; continue; } }
      else { out.errors.push(r.error); if (r.stop) break; }
    }
    if (await inferContactEmail(db, id, fetchImpl)) out.emails++;
  }
  out.conflicts = await checkConflicts(db, trigger.mandateId, { orgId: trigger.orgId, excludeContactIds: contactIds });
  out.blocked = out.conflicts.some(c => c.blocking) && !input.overrideConflicts;
  await db.update(triggers).set({ status: "pursued", updatedAt: new Date().toISOString() }).where(eq(triggers.id, trigger.id));
  await db.insert(activities).values({ mandateId: trigger.mandateId, orgId: trigger.orgId, type: "note", method: "trigger", detail: `Pursued trigger: ${trigger.summary.slice(0, 160)} (${out.saved} people)`, source: "manual", actor: input.actor });
  if (input.sequenceId && !out.blocked && contactIds.length) {
    out.enrolled = await enrollContacts(db, { contactIds, sequenceId: input.sequenceId, actor: input.actor });
  }
  return out;
}

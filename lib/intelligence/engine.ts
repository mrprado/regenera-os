// Intelligence engine: turns a trigger into Regenera knowledge. Relevance is derived per dimension from Regenera's own
// records (projects, capital profiles, relationships, partners, engagements, watches), each with reason, evidence and
// confidence; a person can override any dimension with a reason. Also: thesis → mandate gaps and the watch feed.
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { capitalProfiles, contacts, engagements, mandateEvidence, networkProfiles, organizations, partners, projects, relationships, signalAssessments, theses, triggers, watches } from "@/db/schema";
import type { RelevanceItem } from "@/db/intelligence";
import type { Db } from "@/db";
import { audit } from "@/lib/audit";
import { RELEVANCE_DIMENSIONS, type Rating, type RelevanceDimension, type SIGNAL_TYPES } from "./vocab";

type Trigger = typeof triggers.$inferSelect;
const TYPE_TO_SIGNAL: Record<string, keyof typeof SIGNAL_TYPES> = { capital: "financing", regulatory: "regulation", project: "project_announcement", procurement: "government_program", people: "executive_move", commitment: "thesis", crisis: "other", event: "other" };
const TYPE_TO_SERVICES: Record<string, string[]> = { capital: ["capital_strategy", "investor_readiness", "transaction_support"], project: ["project_screening", "site_intel_assess", "development_management"], regulatory: ["jurisdiction_intel", "regulatory_monitoring"], procurement: ["project_screening", "prefeasibility"], commitment: ["nature_transition", "eva", "capital_strategy"], people: ["diagnostic"], crisis: ["jurisdiction_intel"], event: ["market_intel"] };

export function defaultSignalType(t: Pick<Trigger, "type">) { return TYPE_TO_SIGNAL[t.type] ?? "other"; }

/** Derive each relevance dimension from records. Dimensions that need judgement start Unknown for a person to rate. */
export async function deriveRelevance(db: Db, t: Trigger): Promise<{ items: RelevanceItem[]; related: { projectIds: string[]; profileIds: string[]; contactIds: string[]; services: string[] } }> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, t.orgId));
  const country = t.country ?? org?.country ?? null;
  const [profiles, projs, people, partner, network, engs, watched] = await Promise.all([
    db.select({ id: capitalProfiles.id, name: capitalProfiles.name, capitalType: capitalProfiles.capitalType }).from(capitalProfiles).where(and(eq(capitalProfiles.orgId, t.orgId), isNull(capitalProfiles.archivedAt))),
    db.select({ id: projects.id, name: projects.name, country: projects.country, sector: projects.sector, stage: projects.stage }).from(projects).where(and(eq(projects.mandateId, t.mandateId), isNull(projects.archivedAt))),
    db.select({ id: contacts.id, email: contacts.email }).from(contacts).where(eq(contacts.orgId, t.orgId)),
    db.select({ id: partners.id, type: partners.type }).from(partners).where(eq(partners.orgId, t.orgId)),
    db.select({ id: networkProfiles.id, roles: networkProfiles.roles }).from(networkProfiles).where(eq(networkProfiles.orgId, t.orgId)),
    db.select({ id: engagements.id, status: engagements.status }).from(engagements).where(eq(engagements.orgId, t.orgId)),
    db.select({ id: watches.id, reason: watches.reason }).from(watches).where(and(eq(watches.orgId, t.orgId), eq(watches.active, "yes"))),
  ]);
  const emails = people.map(p => p.email).filter((e): e is string => !!e);
  const rel = emails.length ? await db.select({ lastContactAt: relationships.lastContactAt }).from(relationships).where(inArray(relationships.email, emails.slice(0, 90))) : [];
  const sameCountry = country ? projs.filter(p => p.country && p.country.toUpperCase() === country.toUpperCase()) : [];
  const sameSector = org?.sector ? sameCountry.filter(p => p.sector === org.sector) : [];
  const item = (dimension: RelevanceDimension, rating: Rating, reason: string, evidence: string, confidence: "high" | "moderate" | "low"): RelevanceItem => ({ dimension, rating, reason, evidence, confidence, by: "derived" });
  const items: RelevanceItem[] = [
    profiles.length ? item("capital", t.type === "capital" ? "high" : "conditional", `${org?.name ?? "The institution"} has ${profiles.length} capital profile(s) (${profiles.map(p => p.capitalType).join(", ")})`, profiles.map(p => p.name).join("; "), "moderate")
      : item("capital", t.type === "capital" ? "conditional" : "unknown", t.type === "capital" ? "Capital signal; no capital profile for this institution yet" : "No capital profile recorded", "", "low"),
    sameSector.length ? item("project", "high", `${sameSector.length} Regenera project(s) in the same country and sector`, sameSector.map(p => p.name).join("; "), "moderate")
      : sameCountry.length ? item("project", "conditional", `${sameCountry.length} Regenera project(s) in ${country}; sector fit not established`, sameCountry.map(p => p.name).slice(0, 6).join("; "), "low")
      : item("project", "unknown", "No Regenera project in the signal's geography", "", "low"),
    country ? item("geography", sameCountry.length ? "high" : "low", sameCountry.length ? `Regenera is active in ${country}` : `No active Regenera work recorded in ${country}`, country, "moderate") : item("geography", "unknown", "Signal has no geography", "", "low"),
    item("technology", "unknown", "Rate after reading the source (technology is not recorded on triggers)", "", "low"),
    rel.length ? item("relationship", "high", `${rel.length} relationship(s) with people at the institution`, `latest contact ${rel.map(r => r.lastContactAt).filter(Boolean).sort().at(-1) ?? "unknown"}`, "high")
      : people.length ? item("relationship", "conditional", `${people.length} contact(s) recorded; no relationship history`, "", "moderate") : item("relationship", "low", "No people recorded at the institution", "", "moderate"),
    partner.length || network.length ? item("partnership", "conditional", `Recorded as ${[...partner.map(p => p.type ?? "partner"), ...network.flatMap(n => n.roles)].join(", ")}`, "", "moderate") : item("partnership", "unknown", "No partner or network role recorded", "", "low"),
    item("service", "conditional", `Signal type "${t.type}" typically relates to these services`, (TYPE_TO_SERVICES[t.type] ?? []).join(", "), "low"),
    engs.length ? item("revenue", "high", `${engs.length} engagement(s) with this client`, engs.map(e => e.status).join(", "), "high") : item("revenue", "unknown", "No commercial engagement with this institution", "", "low"),
    watched.length ? item("strategic", "high", "Institution is on Regenera's watch list", watched.map(w => w.reason).filter(Boolean).join("; "), "high") : item("strategic", "unknown", "Not on a watch list", "", "low"),
    item("research", "unknown", "Person rates research importance", "", "low"),
    item("content", "unknown", "Person rates field-note / content value", "", "low"),
  ];
  return { items, related: { projectIds: (sameSector.length ? sameSector : sameCountry).slice(0, 10).map(p => p.id), profileIds: profiles.map(p => p.id), contactIds: people.slice(0, 20).map(p => p.id), services: TYPE_TO_SERVICES[t.type] ?? [] } };
}

/** Create or refresh the derived parts of an assessment, keeping every person-rated dimension. */
export async function assess(db: Db, triggerId: string, actor: string) {
  const [t] = await db.select().from(triggers).where(eq(triggers.id, triggerId));
  if (!t) throw new Error("Trigger not found");
  const d = await deriveRelevance(db, t);
  const [existing] = await db.select().from(signalAssessments).where(eq(signalAssessments.triggerId, triggerId));
  if (!existing) {
    const [a] = await db.insert(signalAssessments).values({ mandateId: t.mandateId, triggerId, signalType: defaultSignalType(t), classification: { geography: t.country ?? undefined }, interpretation: { whatChanged: t.summary, whyItMatters: t.decisionRead ?? "", affectedSectors: "", affectedGeographies: t.country ?? "", implications: "" }, relevance: d.items, related: d.related, createdBy: actor }).returning();
    return a;
  }
  const personal = existing.relevance.filter(x => x.by !== "derived");
  const merged = d.items.map(x => personal.find(p => p.dimension === x.dimension) ?? x);
  await db.update(signalAssessments).set({ relevance: merged, related: d.related, updatedAt: new Date().toISOString() }).where(eq(signalAssessments.id, existing.id));
  return { ...existing, relevance: merged, related: d.related };
}

export async function rateDimension(db: Db, assessmentId: string, dimension: RelevanceDimension, rating: Rating, reason: string, evidence: string, actor: string) {
  if (!(dimension in RELEVANCE_DIMENSIONS)) throw new Error("Unknown dimension");
  if (!reason.trim()) throw new Error("Give the reason for the rating");
  const [a] = await db.select().from(signalAssessments).where(eq(signalAssessments.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  const next = a.relevance.filter(x => x.dimension !== dimension).concat({ dimension, rating, reason, evidence, confidence: "moderate", by: "person" });
  await db.update(signalAssessments).set({ relevance: next, reviewedBy: actor, updatedAt: new Date().toISOString() }).where(eq(signalAssessments.id, assessmentId));
  await audit(db, { actor, action: "signal.rate", entity: "signal_assessment", entityId: assessmentId, after: { dimension, rating } });
}

export type ThesisGap = { thesisId: string; theme: string; thesis: string; sectors: string[]; observed: { statement: string; date: string | null }[]; gap: "aligned" | "no_observed_evidence" | "contradicted" };
/** WHAT THEY SAY vs WHAT THEY FINANCE: each thesis against observed-transaction evidence for the same institution. */
export async function thesisGaps(db: Db, orgId: string): Promise<ThesisGap[]> {
  const [ts, profs] = await Promise.all([db.select().from(theses).where(eq(theses.orgId, orgId)), db.select({ id: capitalProfiles.id }).from(capitalProfiles).where(eq(capitalProfiles.orgId, orgId))]);
  const ev = profs.length ? await db.select().from(mandateEvidence).where(and(inArray(mandateEvidence.profileId, profs.map(p => p.id)), eq(mandateEvidence.layer, "observed"))) : [];
  return ts.map(t => {
    const words = [...t.sectors, t.theme.replace(/_/g, " "), ...t.thesis.toLowerCase().split(/\W+/).filter(w => w.length > 5).slice(0, 6)].map(w => w.toLowerCase());
    const matching = ev.filter(e => words.some(w => e.statement.toLowerCase().includes(w)));
    const gap: ThesisGap["gap"] = t.contradictions.trim() ? "contradicted" : matching.length ? "aligned" : "no_observed_evidence";
    return { thesisId: t.id, theme: t.theme, thesis: t.thesis, sectors: t.sectors, observed: matching.map(m => ({ statement: m.statement, date: m.date })), gap };
  });
}

/** Watch feed: triggers about watched institutions or people since the watch was last reviewed (or 90 days). */
export async function watchFeed(db: Db, mandateIds: string[]) {
  if (!mandateIds.length) return [];
  const ws = await db.select().from(watches).where(and(inArray(watches.mandateId, mandateIds), eq(watches.active, "yes")));
  const out: { watch: typeof ws[number]; items: (Trigger & { assessment: typeof signalAssessments.$inferSelect | null })[] }[] = [];
  for (const w of ws) {
    const since = w.lastReviewedAt ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
    let ts: Trigger[] = [];
    if (w.orgId) ts = await db.select().from(triggers).where(and(eq(triggers.orgId, w.orgId), gte(triggers.createdAt, since))).orderBy(desc(triggers.createdAt)).limit(20);
    else if (w.contactId) {
      // Professional activity only: people-type triggers at the person's institution that name them.
      const [c] = await db.select({ name: contacts.fullName, orgId: contacts.orgId }).from(contacts).where(eq(contacts.id, w.contactId));
      if (c?.orgId) ts = (await db.select().from(triggers).where(and(eq(triggers.orgId, c.orgId), eq(triggers.type, "people"), gte(triggers.createdAt, since))).orderBy(desc(triggers.createdAt)).limit(50)).filter(t => c.name && t.summary.toLowerCase().includes(c.name.toLowerCase())).slice(0, 20);
    }
    const as = ts.length ? await db.select().from(signalAssessments).where(inArray(signalAssessments.triggerId, ts.map(t => t.id))) : [];
    out.push({ watch: w, items: ts.map(t => ({ ...t, assessment: as.find(a => a.triggerId === t.id) ?? null })) });
  }
  return out;
}

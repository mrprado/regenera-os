// Project ↔ organization matching (one reusable shape for investors, lenders, EPCs, suppliers, consultants and
// offtakers). Each candidate shows the criteria it met, failed and could not check, with the evidence; there is no
// composite score, and nothing is contacted: shortlisting is a person's decision.
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db";
import { networkProfiles, ontologyMatches, organizations, projectParties, projects } from "@/db/schema";
import { MATCH_ROLE, type MATCH_KINDS } from "@/lib/ontology/taxonomies";

type Kind = keyof typeof MATCH_KINDS;
type Project = typeof projects.$inferSelect;
export type Candidate = { orgId: string; name: string; met: string[]; failed: string[]; unknown: string[]; evidence: string[] };

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export function assess(p: Project, org: { id: string; name: string; country: string | null; sector: string | null }, profile: typeof networkProfiles.$inferSelect | undefined, history: { role: string; projectName: string; assetClass: string | null; country: string | null }[], kind: Kind): Candidate {
  const met: string[] = [], failed: string[] = [], unknown: string[] = [], evidence: string[] = [];
  const roles = MATCH_ROLE[kind];
  const profRoles = (profile?.roles ?? []).filter(r => roles.network.includes(r));
  const done = history.filter(h => roles.party.includes(h.role));
  if (profRoles.length) { met.push(`Role: ${profRoles.join(", ")}`); evidence.push("Network profile"); }
  if (done.length) { met.push(`Has been ${done[0].role} on ${done.length} other project(s)`); evidence.push(...done.slice(0, 3).map(h => `${h.role} on ${h.projectName}`)); }
  if (p.assetClass) {
    if ((profile?.assetClasses ?? []).includes(p.assetClass) || done.some(h => h.assetClass === p.assetClass)) met.push(`Asset class ${p.assetClass.replace(/_/g, " ")}`);
    else if (profile?.assetClasses.length) failed.push(`Asset class ${p.assetClass.replace(/_/g, " ")} not in profile`);
    else unknown.push("Asset class experience");
  }
  if (p.technology) {
    if (profile?.technologies && profile.technologies.toLowerCase().includes(p.technology.toLowerCase())) met.push(`Technology ${p.technology}`);
    else unknown.push(`Technology ${p.technology}`);
  }
  if (p.country) {
    const where = profile?.jurisdictions ?? [];
    if (where.some(j => same(j, p.country)) || same(org.country, p.country) || done.some(h => same(h.country, p.country))) met.push(`Present in ${p.country}`);
    else if (where.length) failed.push(`Not present in ${p.country} per profile`);
    else unknown.push(`Presence in ${p.country}`);
  }
  if (p.capacity !== null && profile && (profile.minProjectSize !== null || profile.maxProjectSize !== null)) {
    const okMin = profile.minProjectSize === null || p.capacity >= profile.minProjectSize, okMax = profile.maxProjectSize === null || p.capacity <= profile.maxProjectSize;
    (okMin && okMax ? met : failed).push(`Size ${p.capacity} ${p.capacityUnit ?? ""} vs range ${profile.minProjectSize ?? "–"}–${profile.maxProjectSize ?? "–"}`.trim());
  }
  if (kind !== "offtaker" && profile) (profile.bankable ? met : unknown).push(profile.bankable ? "Marked bankable / tier-1" : "Bankability");
  return { orgId: org.id, name: org.name, met, failed, unknown, evidence };
}

/** Candidates for a project and kind: organizations with a matching network role or past project role. */
export async function findCandidates(db: Db, mandateIds: string[], project: Project, kind: Kind, limit = 25): Promise<Candidate[]> {
  if (!mandateIds.length) return [];
  const roles = MATCH_ROLE[kind];
  const [profiles, parties] = await Promise.all([
    db.select().from(networkProfiles).where(inArray(networkProfiles.mandateId, mandateIds)),
    roles.party.length ? db.select({ orgId: projectParties.orgId, role: projectParties.role, projectName: projects.name, assetClass: projects.assetClass, country: projects.country }).from(projectParties).innerJoin(projects, eq(projects.id, projectParties.projectId))
      .where(and(inArray(projectParties.mandateId, mandateIds), inArray(projectParties.role, roles.party as never[]), ne(projectParties.projectId, project.id))) : Promise.resolve([]),
  ]);
  const prof = new Map(profiles.filter(p => p.roles.some(r => roles.network.includes(r))).map(p => [p.orgId, p]));
  const hist = new Map<string, { role: string; projectName: string; assetClass: string | null; country: string | null }[]>();
  for (const h of parties) if (h.orgId) hist.set(h.orgId, [...(hist.get(h.orgId) ?? []), h]);
  const ids = [...new Set([...prof.keys(), ...hist.keys()])].slice(0, 90);
  if (!ids.length) return [];
  const orgs = await db.select({ id: organizations.id, name: organizations.name, country: organizations.country, sector: organizations.sector }).from(organizations).where(and(inArray(organizations.id, ids), isNull(organizations.archivedAt)));
  return orgs.map(o => assess(project, o, prof.get(o.id), hist.get(o.id) ?? [], kind))
    .sort((a, b) => b.met.length - a.met.length || a.failed.length - b.failed.length || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Saves the current assessment (suggested) or a person's decision; the criteria are re-recorded each time. */
export async function recordMatch(db: Db, mandateId: string, projectId: string, kind: Kind, c: Candidate, status: "suggested" | "shortlisted" | "dismissed", actor: string) {
  const values = { mandateId, projectId, kind, orgId: c.orgId, met: c.met, failed: c.failed, unknown: c.unknown, evidence: c.evidence, status, decidedBy: status === "suggested" ? null : actor, updatedAt: new Date().toISOString() };
  await db.insert(ontologyMatches).values(values).onConflictDoUpdate({ target: [ontologyMatches.projectId, ontologyMatches.kind, ontologyMatches.orgId], set: values });
}

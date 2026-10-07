// Canonical relationship vocabulary (the graph grammar). Every predicate names the entity types allowed at each end;
// lib/ontology/validate.ts refuses an edge that breaks the grammar. Edges carry optional validity dates, so the graph
// can answer "who was the developer in March?".
import type { EntityType } from "./entities";

type P = { label: string; from: EntityType[]; to: EntityType[] };
const ORG: EntityType[] = ["organization"];
const PERSON: EntityType[] = ["person"];
const PROJ: EntityType[] = ["project"];
const PARTY: EntityType[] = ["organization", "person"];

export const PREDICATES = {
  // people and organizations
  works_at: { label: "works at", from: PERSON, to: ORG },
  founded: { label: "founded", from: PARTY, to: ORG },
  advises: { label: "advises", from: PARTY, to: ["organization", "project"] },
  knows: { label: "knows", from: PERSON, to: PERSON },
  introduced_by: { label: "introduced by", from: PARTY, to: PARTY },
  referred: { label: "referred", from: PARTY, to: ["organization", "person", "project"] },
  met_at: { label: "met at", from: PERSON, to: ["person", "organization"] },
  partnered_with: { label: "partnered with", from: PARTY, to: ["organization", "person", "project"] },
  parent_of: { label: "parent of", from: ORG, to: ORG },
  subsidiary_of: { label: "subsidiary of", from: ORG, to: ORG },
  beneficial_owner_of: { label: "beneficial owner of", from: PARTY, to: ORG },
  director_of: { label: "director of", from: PERSON, to: ORG },
  // organizations and projects
  develops: { label: "develops", from: PARTY, to: PROJ },
  owns: { label: "owns", from: PARTY, to: ["project", "organization", "parcel", "infrastructure_asset"] },
  operates: { label: "operates", from: ORG, to: ["project", "infrastructure_asset"] },
  builds: { label: "builds (EPC)", from: ORG, to: PROJ },
  supplies: { label: "supplies", from: ORG, to: ["project", "equipment"] },
  manufactures: { label: "manufactures", from: ORG, to: ["equipment"] },
  has_offtake_with: { label: "has offtake with", from: PROJ, to: ORG },
  financed: { label: "financed", from: PARTY, to: ["project", "organization"] },
  invested_in: { label: "invested in", from: PARTY, to: ["project", "organization", "fund"] },
  contracts_with: { label: "contracts with", from: ["organization", "project"], to: ["organization", "project"] },
  insures: { label: "insures", from: ORG, to: PROJ },
  regulates: { label: "regulates", from: ORG, to: ["project", "permit"] },
  // capital
  manages: { label: "manages", from: ORG, to: ["fund"] },
  requires_capital: { label: "requires capital", from: PROJ, to: ["capital_requirement"] },
  has_mandate: { label: "has mandate", from: ["fund", "organization"], to: ["commercial_mandate"] },
  matches: { label: "matches", from: ["commercial_mandate", "fund", "organization"], to: PROJ },
  committed_to: { label: "committed to", from: ["organization", "fund"], to: ["capital_requirement"] },
  // place and assets
  located_at: { label: "located at", from: ["project", "infrastructure_asset", "organization"], to: ["site"] },
  contains: { label: "contains", from: ["site"], to: ["parcel", "infrastructure_asset"] },
  connects_to: { label: "connects to", from: ["project", "infrastructure_asset"], to: ["grid_node"] },
  uses: { label: "uses", from: PROJ, to: ["equipment"] },
  near: { label: "near", from: ["project", "site"], to: ["infrastructure_asset", "site", "project"] },
  upstream_of: { label: "upstream of", from: ["site", "project"], to: ["site", "project"] },
  downstream_of: { label: "downstream of", from: ["site", "project"], to: ["site", "project"] },
  // permits, stakeholders, engagements
  requires: { label: "requires", from: PROJ, to: ["permit"] },
  depends_on: { label: "depends on", from: ["permit"], to: ["permit"] },
  issued_by: { label: "issued by", from: ["permit"], to: ORG },
  affects: { label: "affects", from: ["signal", "project"], to: ["project", "organization", "stakeholder"] },
  engaged_with: { label: "engaged with", from: PROJ, to: ["stakeholder"] },
  covers: { label: "covers", from: ["engagement", "contract"], to: PROJ },
  client_of: { label: "client of", from: ORG, to: ["engagement"] },
  party_to: { label: "party to", from: PARTY, to: ["contract"] },
  // evidence
  supports: { label: "supports", from: ["document", "evidence"], to: ["claim"] },
  verifies: { label: "verifies", from: ["evidence"], to: ["claim"] },
  about: { label: "about", from: ["claim", "document", "observation"], to: ["project", "organization", "person", "site", "parcel", "permit", "contract"] },
  derived_from: { label: "derived from", from: ["observation", "claim"], to: ["source", "document"] },
} as const satisfies Record<string, P>;

export type Predicate = keyof typeof PREDICATES;
export const PREDICATE_KEYS = Object.keys(PREDICATES) as [Predicate, ...Predicate[]];

/** Is `from --predicate--> to` grammatical? */
export function allowedEdge(predicate: string, from: string, to: string): boolean {
  const p = (PREDICATES as Record<string, P>)[predicate];
  return !!p && p.from.includes(from as EntityType) && p.to.includes(to as EntityType);
}

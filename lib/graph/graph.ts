// Relationship graph and warm paths (master build instruction §14). Nodes: Regenera, people, organizations, projects.
// Edges come from records (with their source) plus manual edges. Warm path = cheapest route from Regenera to a target,
// where cost falls with relationship strength; every hop says why it exists.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { bids, contactsTable, contractParties, contracts, introductions, organizations, projectParties, projects, relationshipEdges, relationships } from "./tables";

export type NodeKey = string; // "regenera" | "p:<contactId>" | "o:<orgId>" | "prj:<projectId>"
export type Edge = { a: NodeKey; b: NodeKey; type: string; strength: number; why: string };
export type Graph = { nodes: Map<NodeKey, { label: string; kind: "regenera" | "person" | "organization" | "project" }>; edges: Edge[] };

const key = (t: string, id: string) => (t === "person" ? `p:${id}` : t === "organization" ? `o:${id}` : `prj:${id}`);

export async function buildGraph(db: Db, mandateIds: string[]): Promise<Graph> {
  const m = mandateIds.length ? mandateIds : ["-"];
  const [people, orgs, projs, rels, intros, parties, cparties, bidRows, manual] = await Promise.all([
    db.select({ id: contactsTable.id, name: contactsTable.fullName, orgId: contactsTable.orgId, email: contactsTable.emailLower, title: contactsTable.title }).from(contactsTable).where(and(inArray(contactsTable.mandateId, m), isNull(contactsTable.archivedAt))).limit(5000),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(inArray(organizations.mandateId, m), isNull(organizations.archivedAt))).limit(5000),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(and(inArray(projects.mandateId, m), isNull(projects.archivedAt))),
    db.select({ email: relationships.email, strength: relationships.strength, mailbox: relationships.mailbox, meetings: relationships.meetings, last: relationships.lastContactAt }).from(relationships).where(inArray(relationships.mandateId, m)).limit(5000),
    db.select().from(introductions).where(inArray(introductions.mandateId, m)),
    db.select({ projectId: projectParties.projectId, orgId: projectParties.orgId, contactId: projectParties.contactId, role: projectParties.role, confirmed: projectParties.confirmed }).from(projectParties).where(inArray(projectParties.mandateId, m)),
    db.select({ orgId: contractParties.orgId, contactId: contractParties.contactId, role: contractParties.role, projectId: contracts.projectId, title: contracts.title }).from(contractParties).innerJoin(contracts, eq(contracts.id, contractParties.contractId)).where(and(inArray(contractParties.mandateId, m), isNotNull(contracts.projectId))),
    db.select({ orgId: bids.orgId, projectId: bids.projectId, status: bids.status }).from(bids).where(and(inArray(bids.mandateId, m), isNotNull(bids.orgId))),
    db.select().from(relationshipEdges).where(inArray(relationshipEdges.mandateId, m)),
  ]);
  const g: Graph = { nodes: new Map([["regenera", { label: "Regenera", kind: "regenera" }]]), edges: [] };
  for (const p of people) g.nodes.set(`p:${p.id}`, { label: p.name + (p.title ? ` (${p.title})` : ""), kind: "person" });
  for (const o of orgs) g.nodes.set(`o:${o.id}`, { label: o.name, kind: "organization" });
  for (const p of projs) g.nodes.set(`prj:${p.id}`, { label: p.name, kind: "project" });
  const add = (a: NodeKey, b: NodeKey, type: string, strength: number, why: string) => { if (g.nodes.has(a) && g.nodes.has(b) && a !== b) g.edges.push({ a, b, type, strength: Math.max(0.05, Math.min(1, strength)), why }); };

  for (const p of projs) add("regenera", `prj:${p.id}`, "develops", 0.9, "Regenera project");
  for (const p of people) if (p.orgId) add(`p:${p.id}`, `o:${p.orgId}`, "works_at", 0.6, "Works at");
  const byEmail = new Map(people.filter(p => p.email).map(p => [p.email!, p.id]));
  for (const r of rels) {
    const pid = byEmail.get(r.email.toLowerCase());
    if (pid) add("regenera", `p:${pid}`, "knows", r.strength > 1 ? Math.min(1, r.strength / 10) : r.strength || 0.3, `Correspondence with ${r.mailbox}${r.meetings ? `, ${r.meetings} meetings` : ""}${r.last ? `, last ${r.last.slice(0, 10)}` : ""}`);
  }
  for (const i of intros) {
    if (i.toContactId) add(`p:${i.fromContactId}`, `p:${i.toContactId}`, "introduced_by", i.status === "made" ? 0.8 : 0.5, `Introduction (${i.status})${i.date ? ` ${i.date}` : ""}`);
    if (i.toOrgId) add(`p:${i.fromContactId}`, `o:${i.toOrgId}`, "introduced_by", i.status === "made" ? 0.8 : 0.5, `Introduction (${i.status})`);
  }
  for (const pp of parties) {
    const type = pp.role === "sponsor" || pp.role === "developer" ? "develops" : pp.role === "lender" || pp.role === "investor" ? "financed" : pp.role === "epc" || pp.role === "oem" ? "supplies" : "partnered_with";
    if (pp.orgId) add(`o:${pp.orgId}`, `prj:${pp.projectId}`, type, pp.confirmed === "confirmed" ? 0.8 : 0.4, `Project ${pp.role}${pp.confirmed === "proposed" ? " (proposed)" : ""}`);
    if (pp.contactId) add(`p:${pp.contactId}`, `prj:${pp.projectId}`, type, pp.confirmed === "confirmed" ? 0.8 : 0.4, `Project ${pp.role}`);
  }
  for (const c of cparties) {
    if (c.orgId && c.projectId) add(`o:${c.orgId}`, `prj:${c.projectId}`, "contracts_with", 0.7, `Party to ${c.title}`);
  }
  for (const b of bidRows) if (b.orgId) add(`o:${b.orgId}`, `prj:${b.projectId}`, "supplies", b.status === "selected" ? 0.8 : 0.4, `Bid (${b.status})`);
  for (const e of manual) add(key(e.fromType, e.fromId), key(e.toType, e.toId), e.type, e.strength, `${e.type.replace(/_/g, " ")}${e.note ? `: ${e.note}` : ""} (recorded by ${e.createdBy})`);
  return g;
}

export type Path = { nodes: NodeKey[]; hops: { from: string; to: string; why: string; strength: number }[]; cost: number; warmth: number };

/** k cheapest simple paths from Regenera to the target (Dijkstra with a per-path visited set; cost = 1/strength). */
export function warmPaths(g: Graph, target: NodeKey, k = 3, maxHops = 5): Path[] {
  const adj = new Map<NodeKey, Edge[]>();
  for (const e of g.edges) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), { ...e, a: e.b, b: e.a }]);
  }
  const out: Path[] = [];
  const queue: { node: NodeKey; path: NodeKey[]; edges: Edge[]; cost: number }[] = [{ node: "regenera", path: ["regenera"], edges: [], cost: 0 }];
  let guard = 0;
  while (queue.length && out.length < k && guard++ < 20000) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    if (cur.node === target) {
      out.push({ nodes: cur.path, cost: cur.cost, warmth: Math.round((cur.edges.reduce((p, e) => p * e.strength, 1)) * 100) / 100,
        hops: cur.edges.map((e, i) => ({ from: g.nodes.get(cur.path[i])!.label, to: g.nodes.get(cur.path[i + 1])!.label, why: e.why, strength: e.strength })) });
      continue;
    }
    if (cur.path.length > maxHops) continue;
    for (const e of adj.get(cur.node) ?? []) {
      if (cur.path.includes(e.b)) continue;
      queue.push({ node: e.b, path: [...cur.path, e.b], edges: [...cur.edges, e], cost: cur.cost + 1 / e.strength });
    }
  }
  return out;
}

/** Nodes within `depth` hops of a node, for the ego-network view. */
export function neighbourhood(g: Graph, center: NodeKey, depth = 2, limit = 40) {
  const seen = new Set([center]);
  let frontier = [center];
  const edges: Edge[] = [];
  for (let d = 0; d < depth; d++) {
    const next: NodeKey[] = [];
    for (const e of g.edges) {
      for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) {
        if (frontier.includes(x) && seen.size < limit) {
          if (!seen.has(y)) { seen.add(y); next.push(y); }
          edges.push(e);
        }
      }
    }
    frontier = next;
  }
  return { nodes: [...seen], edges: edges.filter((e, i, a) => seen.has(e.a) && seen.has(e.b) && a.indexOf(e) === i) };
}

// Playbook toolbox: functions a run step may call. Each declares the governance it needs; the engine refuses to mark
// a step done by tool unless the step is autonomous (review/approval steps record the tool's output and wait).
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { capitalOpportunities, constraints, contacts, deals, placeFacts, projectReadiness, projects, studies } from "@/db/schema";
import { runMatches } from "@/lib/capital/engine";
import { studyGaps } from "@/lib/delivery/engine";
import { STUDY_TYPES } from "@/lib/delivery/vocab";
import { enqueue } from "@/lib/jobs/queue";

export type ToolResult = { ok: boolean; note: string };
type Tool = { label: string; entity: string; run: (db: Db, entityId: string, now: Date) => Promise<ToolResult> };

export const TOOLS: Record<string, Tool> = {
  "place.profile": {
    label: "Build the place profile from public sources (NASA POWER, World Bank, OSM, USGS, GBIF)", entity: "project",
    run: async (db, id, now) => {
      const [p] = await db.select({ lat: projects.lat }).from(projects).where(eq(projects.id, id));
      if (p?.lat === null || p?.lat === undefined) return { ok: false, note: "No coordinates: set latitude and longitude first" };
      await enqueue(db, "place.profile", { projectId: id }, { dedupeKey: `place:${id}:${now.toISOString().slice(0, 13)}`, now });
      const [n] = await db.select({ n: sql<number>`count(*)` }).from(placeFacts).where(eq(placeFacts.projectId, id));
      return { ok: true, note: `Place profile queued (runs on the next job tick); ${n.n} facts on record now` };
    },
  },
  "study.gaps": {
    label: "Compare recorded studies with those expected for the asset class", entity: "project",
    run: async (db, id) => {
      const [p] = await db.select({ assetClass: projects.assetClass, stage: projects.stage }).from(projects).where(eq(projects.id, id));
      if (!p) return { ok: false, note: "Project not found" };
      const g = studyGaps(p, await db.select({ type: studies.type, status: studies.status }).from(studies).where(eq(studies.projectId, id)));
      return { ok: true, note: g.missing.length ? `Missing: ${g.missing.map(t => STUDY_TYPES[t]).join(", ")}${g.pending.length ? `; under way: ${g.pending.map(t => STUDY_TYPES[t]).join(", ")}` : ""}` : "All expected studies started or received" };
    },
  },
  "readiness.summary": {
    label: "Summarise readiness and open constraints", entity: "project",
    run: async (db, id) => {
      const rs = await db.select({ status: projectReadiness.status }).from(projectReadiness).where(eq(projectReadiness.projectId, id));
      const [c] = await db.select({ n: sql<number>`count(*)` }).from(constraints).where(and(eq(constraints.projectId, id), ne(constraints.status, "resolved")));
      return { ok: true, note: `${rs.filter(r => r.status !== "unknown").length}/14 dimensions recorded, ${rs.filter(r => r.status === "blocked").length} blocked; ${c.n} open constraints` };
    },
  },
  "capital.match": {
    label: "Run transparent capital matching for the project's opportunities", entity: "project",
    run: async (db, id, now) => {
      const opps = await db.select({ id: capitalOpportunities.id }).from(capitalOpportunities).where(eq(capitalOpportunities.projectId, id));
      if (!opps.length) return { ok: false, note: "No capital opportunity yet: create one from a capital requirement" };
      for (const o of opps) await runMatches(db, o.id, now);
      return { ok: true, note: `Matching run for ${opps.length} opportunit${opps.length === 1 ? "y" : "ies"}; review the matches (eligibility is a gate)` };
    },
  },
  "org.relationship": {
    label: "Check existing contacts and opportunities with the organization", entity: "organization",
    run: async (db, id) => {
      const [c] = await db.select({ n: sql<number>`count(*)` }).from(contacts).where(eq(contacts.orgId, id));
      const [d] = await db.select({ n: sql<number>`count(*)` }).from(deals).where(eq(deals.orgId, id));
      return { ok: true, note: `${c.n} people, ${d.n} opportunities on record` };
    },
  },
};

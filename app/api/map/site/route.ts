import { and, desc, eq } from "drizzle-orm";
import { placeFacts, projects, siteIntelRuns } from "@/db/schema";
import { STAGES } from "@/lib/site-intel/engine";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";

const SECTIONS: Record<string, string[]> = {
  Energy: ["solar_ghi", "pv_specific_yield", "pv_plane_irradiation", "wind_10m", "country_elec_access"],
  Infrastructure: ["substations_20km", "nearest_substation", "power_lines_20km", "roads_5km"],
  Water: ["precip"], Ecology: ["gbif_occurrences", "gbif_species", "gbif_threatened", "active_fires"],
  Climate: ["temp_mean", "quakes_50y", "largest_quake"], Community: [], Land: [], Permitting: [],
};

// Guarded: the selected site's context from its place profile, grouped the way the Atlas panel shows it.
export async function GET(request: Request) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("projectId") ?? "";
  const [p] = await appDb().select({ id: projects.id, name: projects.name, lat: projects.lat, lng: projects.lng, country: projects.country, subdivision: projects.subdivision, geometry: projects.geometry }).from(projects)
    .where(and(eq(projects.id, id), mandateCondition(user.scope, projects.mandateId)));
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const facts = await appDb().select({ key: placeFacts.key, label: placeFacts.label, value: placeFacts.value, source: placeFacts.integrationKey, tier: placeFacts.tier, state: placeFacts.state, retrievedAt: placeFacts.retrievedAt, dimension: placeFacts.dimension })
    .from(placeFacts).where(eq(placeFacts.projectId, p.id));
  const used = new Set<string>();
  const sections = Object.entries(SECTIONS).map(([name, keys]) => {
    const rows = facts.filter(f => keys.includes(f.key));
    rows.forEach(r => used.add(r.key));
    return { name, facts: rows };
  });
  const other = facts.filter(f => !used.has(f.key));
  if (other.length) sections.push({ name: "Other context", facts: other });
  // The latest staged site-intelligence run, when there is one, supersedes the older place-profile grouping.
  const [run] = await appDb().select().from(siteIntelRuns).where(eq(siteIntelRuns.projectId, p.id)).orderBy(desc(siteIntelRuns.createdAt)).limit(1);
  if (run) {
    const label = new Map<string, string>(STAGES.map(([k, l]) => [k, l]));
    const staged = run.stages.map(st => ({ name: label.get(st.key) ?? st.key, facts: st.status === "done" ? (st.facts ?? []).map((f, i) => ({ key: `${st.key}-${i}`, label: f.label, value: f.value, source: f.source, tier: 2, state: "fresh", retrievedAt: st.finishedAt ?? run.createdAt, dimension: st.key })) : st.status === "failed" ? [{ key: `${st.key}-err`, label: "Unavailable", value: st.error ?? "", source: "site intelligence", tier: 3, state: "stale", retrievedAt: st.finishedAt ?? run.createdAt, dimension: st.key }] : [] }));
    return Response.json({ project: p, sections: staged, run: { id: run.id, status: run.status, createdAt: run.createdAt } }, { headers: { "cache-control": "private, max-age=30" } });
  }
  return Response.json({ project: p, sections }, { headers: { "cache-control": "private, max-age=30" } });
}

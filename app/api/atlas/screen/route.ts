import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { adminChain } from "@/lib/fabric/adapters";
import { createProject } from "@/lib/projects/engine";
import { country as countryOf } from "@/lib/scan/countries";
import { startRun } from "@/lib/site-intel/engine";

// Atlas site workflow (phase 21 Atlas §4): a point or drawn polygon becomes a site record (a project at stage
// Opportunity, origination "Atlas site screen"), resolved to its jurisdiction, and a full site-intelligence run starts
// (grid, water, ecology, terrain, hazards, capital & opportunities, partners, saved assessment). An existing project
// at the same spot (within ~100 m) is reused instead of duplicated. Open-access visitors are refused (writes).
const zBody = z.object({
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  geometry: z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.array(z.any()) }).optional(),
  name: z.string().trim().max(200).optional(), projectId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const user = await getOsApiUser({ write: true });
  if (!user) return Response.json({ error: "Sign in to screen and save a site" }, { status: 401 });
  const parsed = zBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send lat, lng and optionally a polygon" }, { status: 400 });
  const b = parsed.data;
  const db = appDb();
  let projectId = b.projectId ?? null;
  if (projectId) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) return Response.json({ error: "Project not found" }, { status: 404 });
  } else {
    const near = (await db.select({ id: projects.id, lat: projects.lat, lng: projects.lng, origination: projects.originationSource }).from(projects).where(mandateCondition(user.scope, projects.mandateId)))
      .find(p => p.lat != null && p.lng != null && Math.abs(p.lat - b.lat) < 0.001 && Math.abs(p.lng - b.lng) < 0.001);
    if (near) projectId = near.id;
    else {
      const admin = await adminChain(db, b.lat, b.lng).catch(() => null);
      const iso = admin?.countryCode ? countryOf(admin.countryCode)?.iso3 ?? null : null;
      const place = [admin?.municipality, admin?.state].filter(Boolean).join(", ");
      const p = await createProject(db, {
        mandateId: user.scope.mandateIds[0], name: (b.name || `Site · ${place || `${b.lat.toFixed(3)}, ${b.lng.toFixed(3)}`}`).slice(0, 200),
        lat: b.lat, lng: b.lng, geometry: b.geometry ? JSON.stringify(b.geometry) : null, country: iso, subdivision: admin?.state ?? null, municipality: admin?.municipality ?? null,
        originationSource: "Atlas site screen", ownerEmail: user.email, locationPrecision: b.geometry ? "reported_site" : "town",
        locationSource: `${b.geometry ? "Boundary drawn" : "Point selected"} in Atlas by ${user.email} on ${new Date().toISOString().slice(0, 10)}${admin ? ` · jurisdiction from OpenStreetMap: ${[admin.municipality, admin.state, admin.country].filter(Boolean).join(", ")}` : ""}`,
      }, user.email);
      await audit(db, { actor: user.email, action: "atlas.site_created", entity: "project", entityId: p.id, after: { lat: b.lat, lng: b.lng, country: iso } });
      projectId = p.id;
    }
  }
  try {
    const run = await startRun(db, projectId, user.email);
    return Response.json({ projectId, runId: run.id, stages: run.stages });
  } catch (e) { return Response.json({ error: (e as Error).message, projectId }, { status: 400 }); }
}

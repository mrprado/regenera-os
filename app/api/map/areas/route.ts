import type { Feature, Geometry } from "geojson";
import { and, isNotNull, isNull } from "drizzle-orm";
import { projects } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { geometryAreaKm2 } from "@/lib/geo/geo";

// Guarded: project boundaries (GeoJSON polygons recorded on projects) with their area.
export async function GET() {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const rows = await appDb().select({ id: projects.id, name: projects.name, stage: projects.stage, geometry: projects.geometry }).from(projects)
    .where(and(mandateCondition(user.scope, projects.mandateId), isNull(projects.archivedAt), isNotNull(projects.geometry)));
  const features: Feature[] = [];
  for (const r of rows) {
    try {
      const g = JSON.parse(r.geometry!) as Geometry;
      if (g.type === "Polygon" || g.type === "MultiPolygon") features.push({ type: "Feature", geometry: g, properties: { id: r.id, name: r.name, stage: r.stage, areaKm2: Math.round(geometryAreaKm2(g) * 100) / 100 } });
    } catch { /* invalid geometry text is skipped; the project page shows it */ }
  }
  return Response.json({ type: "FeatureCollection", features }, { headers: { "cache-control": "no-store" } });
}

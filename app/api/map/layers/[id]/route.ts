import type { FeatureCollection } from "geojson";
import { and, eq } from "drizzle-orm";
import { spatialLayers } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { clipToBBox, type BBox } from "@/lib/geo/geo";

// Guarded: one layer's features, filtered server-side to the requested bounding box (never the whole dataset).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const { id } = await params;
  const [l] = await appDb().select().from(spatialLayers).where(and(eq(spatialLayers.id, id), mandateCondition(user.scope, spatialLayers.mandateId)));
  if (!l) return Response.json({ error: "Not found" }, { status: 404 });
  const raw = new URL(request.url).searchParams.get("bbox");
  const parts = raw?.split(",").map(Number);
  const box: BBox = parts && parts.length === 4 && parts.every(Number.isFinite) ? [Math.max(-180, parts[0]), Math.max(-90, parts[1]), Math.min(180, parts[2]), Math.min(90, parts[3])] : [-180, -90, 180, 90];
  const fc = clipToBBox(JSON.parse(l.geojson) as FeatureCollection, box, 5000);
  return Response.json({ ...fc, layer: { id: l.id, name: l.name, category: l.category, isDemo: l.isDemo } }, { headers: { "cache-control": "private, max-age=60" } });
}

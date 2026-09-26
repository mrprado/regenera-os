import { desc } from "drizzle-orm";
import { spatialLayers } from "@/db/schema";
import { getOsApiUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";

// Guarded: layer library (metadata and provenance only; features come per layer, clipped to the viewport).
export async function GET() {
  const user = await getOsApiUser();
  if (!user) return Response.json({ error: "Not authorized" }, { status: 401 });
  const rows = await appDb().select({ id: spatialLayers.id, name: spatialLayers.name, category: spatialLayers.category, provider: spatialLayers.provider, sourceDate: spatialLayers.sourceDate, retrievedAt: spatialLayers.retrievedAt,
    license: spatialLayers.license, resolution: spatialLayers.resolution, coverage: spatialLayers.coverage, confidence: spatialLayers.confidence, featureCount: spatialLayers.featureCount, isDemo: spatialLayers.isDemo,
    bbox: [spatialLayers.west, spatialLayers.south, spatialLayers.east, spatialLayers.north] as never })
    .from(spatialLayers).where(mandateCondition(user.scope, spatialLayers.mandateId)).orderBy(desc(spatialLayers.createdAt));
  return Response.json(rows.map(r => ({ ...r, bbox: undefined })), { headers: { "cache-control": "no-store" } });
}

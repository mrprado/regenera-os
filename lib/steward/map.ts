// Steward places for Atlas (phase 28D): scoped to the user's workspaces; sensitive places are generalised (rounded point)
// for anyone who is not a workspace owner; provenance and accuracy travel with each feature.
import type { Db } from "@/db";
import { stewardPlaces } from "@/db/schema";
import { isOwner, mandateCondition, type Scope } from "@/lib/db/scoped";
import { visibleGeometry } from "./engine";
import { GEOMETRY_ACCURACY, PLACE_STATUS } from "./vocab";

export async function stewardPlacesFeed(db: Db, scope: Scope) {
  const rows = await db.select().from(stewardPlaces).where(mandateCondition(scope, stewardPlaces.mandateId));
  const features = rows.filter(p => p.geometry).map(p => {
    const owner = isOwner(scope, p.mandateId);
    const g = visibleGeometry(p, owner)!;
    const generalised = !!(g as { generalised?: boolean }).generalised;
    return { type: "Feature" as const, geometry: { type: g.type, coordinates: (g as { coordinates: unknown }).coordinates },
      properties: { id: p.id, name: p.name, status: PLACE_STATUS[p.status], accuracy: GEOMETRY_ACCURACY[p.geometryAccuracy], generalised: generalised ? 1 : 0, href: `/steward/places/${p.id}`,
        note: generalised ? "Location generalised (sensitive place)" : p.geometryAccuracy === "project_point" ? "Project point only: no boundary" : "" } };
  });
  return { type: "FeatureCollection" as const, features, meta: { count: features.length, source: "Regenera OS Steward records" } };
}

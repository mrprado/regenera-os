"use server";

import type { Geometry } from "geojson";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { projects, spatialLayers } from "@/db/schema";
import { LAYER_CATEGORIES } from "@/db/spatial";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { bboxOf, geometryAreaKm2, MAX_BYTES, parseGeoJSON, parseSpatial } from "@/lib/geo/geo";
import { createProject } from "@/lib/projects/engine";

const zId = z.string().uuid();
const str = (f: FormData, k: string, max = 300) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const note = (text: string) => `/map?notice=${encodeURIComponent(text)}`;

/** Imports a GeoJSON, KML or CSV layer with its provenance. Files are parsed and validated server-side. */
export async function importLayerAction(formData: FormData) {
  let msg = "";
  await withOsUser(async user => {
    const file = formData.get("file");
    const pasted = str(formData, "geojson", MAX_BYTES);
    let text = pasted, filename = "pasted.geojson";
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) throw new Error("File too large (5 MB max): simplify or clip it first");
      text = await file.text(); filename = file.name;
    }
    if (!text) throw new Error("Choose a file or paste GeoJSON");
    const fc = parseSpatial(filename, text);
    const b = bboxOf(fc);
    const name = str(formData, "name", 160) || filename.replace(/\.[^.]+$/, "");
    const [l] = await appDb().insert(spatialLayers).values({
      mandateId: user.scope.mandateIds[0], name, category: z.enum(LAYER_CATEGORIES).catch("other").parse(formData.get("category")),
      provider: str(formData, "provider", 200), sourceDate: str(formData, "sourceDate", 10) || null, license: str(formData, "license", 300), resolution: str(formData, "resolution", 120),
      coverage: str(formData, "coverage", 200), confidence: z.enum(["high", "medium", "low", "unknown"]).catch("unknown").parse(formData.get("confidence")),
      geojson: JSON.stringify(fc), featureCount: fc.features.length, west: b?.[0], south: b?.[1], east: b?.[2], north: b?.[3], createdBy: user.email,
    }).returning({ id: spatialLayers.id });
    await audit(appDb(), { actor: user.email, action: "spatial_layer_imported", entity: "spatial_layers", entityId: l.id, after: { name, features: fc.features.length } });
    msg = `Imported ${fc.features.length} features into "${name}".${str(formData, "license") ? "" : " Record the licence before sharing anything derived from it."}`;
  });
  redirect(note(msg));
}

export async function deleteLayerAction(formData: FormData) {
  const id = zId.parse(formData.get("layerId"));
  await withOsUser(async user => {
    const [l] = await appDb().select({ id: spatialLayers.id, name: spatialLayers.name }).from(spatialLayers).where(and(eq(spatialLayers.id, id), mandateCondition(user.scope, spatialLayers.mandateId)));
    if (!l) throw new Error("Not found");
    await appDb().delete(spatialLayers).where(eq(spatialLayers.id, l.id));
    await audit(appDb(), { actor: user.email, action: "spatial_layer_deleted", entity: "spatial_layers", entityId: l.id, before: { name: l.name } });
  });
  redirect(note("Layer removed."));
}

function polygonFrom(formData: FormData): Geometry {
  const fc = parseGeoJSON(z.string().min(10).max(200_000).parse(formData.get("geometry")));
  const g = fc.features[0].geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") throw new Error("Draw a polygon");
  return g;
}

/** Saves a drawn polygon as a project's boundary and sets its centroid-ish point when missing. */
export async function saveBoundaryAction(formData: FormData) {
  const projectId = zId.parse(formData.get("projectId"));
  let msg = "";
  await withOsUser(async user => {
    const [p] = await appDb().select().from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    const g = polygonFrom(formData);
    const b = bboxOf(g)!;
    await appDb().update(projects).set({ geometry: JSON.stringify(g), lat: p.lat ?? (b[1] + b[3]) / 2, lng: p.lng ?? (b[0] + b[2]) / 2, updatedAt: new Date().toISOString() }).where(eq(projects.id, p.id));
    await audit(appDb(), { actor: user.email, action: "project_boundary", entity: "projects", entityId: p.id, after: { areaKm2: geometryAreaKm2(g) } });
    msg = `Boundary saved on ${p.name} (${(geometryAreaKm2(g) * 100).toFixed(1)} ha).`;
  });
  redirect(note(msg));
}

export async function createProjectAtAction(formData: FormData) {
  const name = z.string().trim().min(2).max(200).parse(formData.get("name"));
  let target = "/map";
  await withOsUser(async user => {
    const g = polygonFrom(formData);
    const b = bboxOf(g)!;
    const p = await createProject(appDb(), { mandateId: user.scope.mandateIds[0], name, geometry: JSON.stringify(g), lat: (b[1] + b[3]) / 2, lng: (b[0] + b[2]) / 2, originationSource: "Atlas", ownerEmail: user.email }, user.email);
    target = `/projects/${p.id}?tab=place&notice=${encodeURIComponent("Project created from the drawn site. Run site intelligence to build its place profile.")}`;
  });
  redirect(target);
}

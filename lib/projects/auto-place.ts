// Automatic approximate placement (phase 21 §3): a project with no coordinates is placed at its municipality (town
// precision) or, failing that, its country (country precision) via OpenStreetMap, so Atlas, site checks and grid
// screening have something to run on. Always marked approximate with its basis; a surveyed or sponsor-reported site
// entered by a person is never overwritten (only rows with lat IS NULL are touched).
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { PRECISION } from "@/lib/portfolio/screen";
import { geocode } from "@/lib/sources/geocode";

export async function autoPlaceProjects(db: Db, limit = 6, now = new Date()) {
  const rows = await db.select().from(projects).where(and(isNull(projects.lat), isNull(projects.archivedAt))).limit(limit);
  let placed = 0, busy = false;
  for (const p of rows) {
    const tries: [string, keyof typeof PRECISION][] = [];
    if (p.municipality) tries.push([[p.municipality, p.subdivision, p.country].filter(Boolean).join(", "), "town"]);
    if (p.subdivision) tries.push([[p.subdivision, p.country].filter(Boolean).join(", "), "region"]);
    if (p.country) tries.push([p.country, "country"]);
    for (const [q, precision] of tries) {
      const g = await geocode(db, q);
      if (g === "busy") { busy = true; break; }
      if (!g) continue;
      const source = `${PRECISION[precision]} · OpenStreetMap: ${g.label} · placed automatically on ${now.toISOString().slice(0, 10)} from "${q}"`;
      await db.update(projects).set({ lat: g.lat, lng: g.lng, locationPrecision: precision, locationSource: source.slice(0, 400), updatedAt: now.toISOString() }).where(and(eq(projects.id, p.id), isNull(projects.lat)));
      await audit(db, { actor: "system:auto-place", action: "project_located", entity: "projects", entityId: p.id, after: { lat: g.lat, lng: g.lng, precision } });
      placed++;
      break;
    }
    if (busy) break;
  }
  return { placed, more: rows.length === limit || busy };
}

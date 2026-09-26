import { afterAll, beforeAll, expect, it } from "vitest";
import { organizations, projects } from "@/db/schema";
import { mapFeatures } from "@/lib/map/features";
import type { UserScope } from "@/lib/db/scoped";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });
const scope: UserScope = { kind: "user", userId: "u", email: "u@example.com", mandateIds: ["visible"], ownerOf: [] };

it("map context remains mandate-scoped, excludes archived data, and reports missing coordinate pairs", async () => {
  await t.db.insert(organizations).values([
    { id: "visible", mandateId: "visible", name: "Public context", nameNormalized: "public context", source: "other", description: "Biomaterial research", industry: "Biomaterials", lat: 0, lng: 0 },
    { id: "hidden", mandateId: "hidden", name: "Private", nameNormalized: "private", source: "other", description: "Hidden text", lat: 1, lng: 1 },
    { id: "missing", mandateId: "visible", name: "Missing longitude", nameNormalized: "missing", source: "other", lat: 20 },
    { id: "archived", mandateId: "visible", name: "Archived", nameNormalized: "archived", source: "other", archivedAt: "2026-01-01" },
  ]);
  await t.db.insert(projects).values([
    { mandateId: "visible", name: "Missing site", lng: 1 },
    { mandateId: "hidden", name: "Hidden project", description: "Hidden description", lat: 5, lng: 5 },
  ]);
  const payload = await mapFeatures(scope, new Date("2026-09-25T12:00:00Z"), t.db);
  expect(payload.organizations.features).toHaveLength(1);
  expect(payload.organizations.features[0].properties).toMatchObject({ id: "visible", description: "Biomaterial research", topics: "Biomaterials" });
  expect(payload.counts.unmapped).toBe(1);
  expect(payload.counts.unmappedProjects).toBe(1);
  expect(payload.projects.features).toHaveLength(0);
  expect(JSON.stringify(payload)).not.toContain("Hidden");
  expect((await mapFeatures({ ...scope, mandateIds: [] }, new Date(), t.db)).organizations.features).toHaveLength(0);
});

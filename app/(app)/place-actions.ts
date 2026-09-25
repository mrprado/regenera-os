"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { integrations, projects } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { appDb, mandateCondition } from "@/lib/db/scoped";
import { clearIntegrationCache, ensureIntegrations } from "@/lib/integrations/engine";
import { buildPlaceProfile } from "@/lib/place/engine";

const zId = z.string().uuid();
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;

export async function buildPlaceAction(formData: FormData) {
  const id = zId.parse(formData.get("id"));
  let msg = "";
  await withOsUser(async user => {
    const [p] = await appDb().select({ id: projects.id, lat: projects.lat, country: projects.country }).from(projects).where(and(eq(projects.id, id), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    if (p.lat === null && !p.country) { msg = "Set the coordinates (or at least the country) on the Overview tab first."; return; }
    const r = await buildPlaceProfile(appDb(), id);
    msg = `${r.written} facts updated from official and open sources.${r.failed.length ? ` Unavailable: ${r.failed.map(f => f.source).join(", ")} (previous values kept, marked stale).` : ""}`;
  });
  redirect(note(`/projects/${id}?tab=place`, msg));
}

export async function setIntegrationStateAction(formData: FormData) {
  const key = z.string().min(2).max(60).parse(formData.get("key"));
  const state = z.enum(["enabled", "development_only", "license_required", "disabled"]).parse(formData.get("state"));
  await withOsUser(async user => {
    const [before] = await appDb().select({ state: integrations.featureState }).from(integrations).where(eq(integrations.key, key));
    await appDb().update(integrations).set({ featureState: state, stateOverridden: true, updatedAt: new Date().toISOString() }).where(eq(integrations.key, key));
    clearIntegrationCache();
    await audit(appDb(), { actor: user.email, action: "integration_state", entity: "integrations", entityId: key, before, after: { state } });
  }, { owner: true });
  redirect(note("/settings/integrations", `${key}: ${state.replace(/_/g, " ")}.`));
}

export async function seedIntegrationsAction() {
  await withOsUser(async () => { await ensureIntegrations(appDb()); }, { owner: true });
  redirect(note("/settings/integrations", "Registry refreshed from the code catalog (owner changes kept)."));
}

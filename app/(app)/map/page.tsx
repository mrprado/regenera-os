import { requireOsUser } from "@/lib/auth";
import MapClient from "./map-client";
import { appDb, isInternal } from "@/lib/db/scoped";
import { integrations } from "@/db/schema";
import { integrationHealth } from "@/lib/integrations/engine";
import { downstreamCounts } from "@/lib/integrations/downstream";
import { CANDIDATES, candidateStatus } from "@/lib/integrations/candidates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atlas" };

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/map");
  // Coverage tab: the source catalogue; call status only for Regenera staff (integration health is internal).
  const healthAllowed = isInternal(user.scope);
  const db = appDb();
  const [rows, health, downstream] = healthAllowed ? await Promise.all([db.select().from(integrations), integrationHealth(db), downstreamCounts(db)]) : [[], new Map(), new Map()];
  const registered = new Set(rows.map(r => r.key));
  const successes = new Map<string, string>([...health.values()].filter(h => h.lastSuccess).map(h => [h.key, h.lastSuccess!]));
  const sources = CANDIDATES.map(c => ({ name: c.name, domain: c.domain, url: c.url, access: c.access, licence: c.licence, status: healthAllowed ? candidateStatus(c, registered, successes, downstream) : "not_verified", lastSuccess: c.registryKey ? successes.get(c.registryKey) ?? null : null }));
  const sp = await searchParams;
  return <>{sp.notice && <p role="status" style={{ position: "absolute", zIndex: 5, left: "50%", transform: "translateX(-50%)", top: 70, background: "var(--paper)", border: "1px solid var(--line)", padding: "6px 12px", borderRadius: 6, fontSize: 13 }}>{sp.notice}</p>}<MapClient sources={sources} /></>;
}

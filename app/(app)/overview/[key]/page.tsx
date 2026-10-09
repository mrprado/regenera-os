import { notFound } from "next/navigation";
import WorkspaceDashboard from "@/components/workspace-dashboard";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal } from "@/lib/db/scoped";
import { HUB_KEYS, hubData, type HubKey } from "@/lib/hubs";
import { WORKSPACE_HUB_KEYS, workspaceHub, type WorkspaceHubKey } from "@/lib/hubs-workspace";
import { activeNavGroup, navFor } from "@/lib/nav";
import { pathAllowed } from "@/lib/tenancy/vocab";

export const dynamic = "force-dynamic";

/** Landing page of a work area (October 2026 redesign): purpose, "Do this next", drill-through metrics, operating path and
 *  tools. Former group keys and phase 24 loop steps keep their URLs and render the area that now owns them. */
export default async function OverviewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const workspace = (WORKSPACE_HUB_KEYS as readonly string[]).includes(key) || key === "projects";
  if (!workspace && !(HUB_KEYS as readonly string[]).includes(key)) notFound();
  const user = await requireOsUser(`/overview/${key}`);
  const hub = workspace ? await workspaceHub(appDb(), key as WorkspaceHubKey, user.scope.mandateIds) : await hubData(appDb(), key as HubKey, user.scope.mandateIds);
  const owner = user.scope.ownerOf.length > 0;
  const group = activeNavGroup(navFor({ modules: user.scope.modules, internal: isInternal(user.scope), owner }), `/overview/${key}`, new URLSearchParams());
  // Links the viewer may not open are dropped, never shown disabled.
  const allowed = (item: { href: string }) => pathAllowed(user.scope.modules, item.href) && (!item.href.startsWith("/settings") || isInternal(user.scope)) && (!item.href.startsWith("/intelligence/mail") || owner);
  const scoped = { ...hub, metrics: hub.metrics.filter(allowed), attention: hub.attention.filter(allowed), recent: hub.recent.filter(allowed), actions: hub.actions.filter(allowed) };
  const refreshedAt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" }).format(new Date());
  return <WorkspaceDashboard hub={scoped} group={group} refreshedAt={refreshedAt} />;
}

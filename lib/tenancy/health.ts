// Client health (prompt §65), internal to Regenera. Plain counts with their definitions; no composite score.
import { and, gte, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { engagements, loginEvents, tenantMembers, tenants } from "@/db/schema";

type Tenant = typeof tenants.$inferSelect;
export type Health = {
  tenantId: string; activeMembers: number; seats: number; activeUsers30: number; logins30: number; loginsPrev30: number;
  engagementsActive: number; deliverablesOpen: number; deliverablesOverdue: number; renewalInDays: number | null; flags: string[];
};

const DONE = new Set(["delivered", "accepted"]);

export async function accountHealth(db: Db, ts: Tenant[], now = new Date()): Promise<Map<string, Health>> {
  const out = new Map<string, Health>();
  if (!ts.length) return out;
  const ids = ts.map(t => t.id);
  const members = await db.select().from(tenantMembers).where(inArray(tenantMembers.tenantId, ids));
  const emails = [...new Set(members.map(m => m.email))];
  const since60 = new Date(now.getTime() - 60 * 86_400_000).toISOString(), since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const logins = emails.length ? await db.select({ email: loginEvents.email, at: loginEvents.at }).from(loginEvents).where(and(inArray(loginEvents.email, emails.slice(0, 90)), gte(loginEvents.at, since60))) : [];
  const crm = ts.map(t => t.crmOrgId).filter((x): x is string => Boolean(x));
  const engs = crm.length ? await db.select().from(engagements).where(inArray(engagements.orgId, crm)) : [];
  const today = now.toISOString().slice(0, 10);
  for (const t of ts) {
    const ms = members.filter(m => m.tenantId === t.id);
    const mine = new Set(ms.map(m => m.email));
    const l = logins.filter(x => mine.has(x.email));
    const e = engs.filter(x => x.orgId === t.crmOrgId);
    const dels = e.flatMap(x => x.deliverables).filter(d => !DONE.has(d.status));
    const renewalInDays = t.renewalDate ? Math.round((Date.parse(t.renewalDate) - now.getTime()) / 86_400_000) : null;
    const activeMembers = ms.filter(m => m.status === "active").length;
    const activeUsers30 = new Set(l.filter(x => x.at >= since30).map(x => x.email)).size;
    const h: Health = {
      tenantId: t.id, activeMembers, seats: t.seatsPurchased, activeUsers30, logins30: l.filter(x => x.at >= since30).length, loginsPrev30: l.filter(x => x.at < since30).length,
      engagementsActive: e.filter(x => ["active", "waiting_on_client", "renewal"].includes(x.status)).length,
      deliverablesOpen: dels.length, deliverablesOverdue: dels.filter(d => d.due && d.due < today).length, renewalInDays, flags: [],
    };
    if (t.kind === "client" && t.status === "active" && activeMembers > 0 && activeUsers30 === 0) h.flags.push("No sign-ins in 30 days");
    if (h.deliverablesOverdue) h.flags.push(`${h.deliverablesOverdue} overdue deliverable${h.deliverablesOverdue > 1 ? "s" : ""}`);
    if (renewalInDays !== null && renewalInDays >= 0 && renewalInDays <= 120) h.flags.push(`Renewal in ${renewalInDays} days`);
    if (t.seatsPurchased && activeMembers > t.seatsPurchased) h.flags.push("Over seat count");
    if (t.requestedModules.length) h.flags.push(`${t.requestedModules.length} module request${t.requestedModules.length > 1 ? "s" : ""}`);
    out.set(t.id, h);
  }
  return out;
}

// Sponsor registry checks (phase 20 §3): the UK Companies House public API (free key, COMPANIES_HOUSE_API_KEY) read
// through fetchJson (registry gate, cache, ledger). A snapshot keeps status, officers, charges and recent filings; the
// next snapshot records what changed (appointments, resignations, new or satisfied charges, status, overdue accounts)
// and raises a compliance notification. The company number comes from the organization's companies_house alias.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { entityAliases, notifications, registrySnapshots } from "@/db/schema";
import type { RegistryChange, RegistryData } from "@/db/casework";
import { fetchJson } from "@/lib/sources/http";

const BASE = "https://api.company-information.service.gov.uk";
const zCompany = z.object({ company_status: z.string().nullish(), date_of_creation: z.string().nullish(), type: z.string().nullish(), sic_codes: z.array(z.string()).nullish(),
  accounts: z.object({ next_due: z.string().nullish(), overdue: z.boolean().nullish(), last_accounts: z.object({ made_up_to: z.string().nullish() }).passthrough().nullish() }).passthrough().nullish() }).passthrough();
const zOfficers = z.object({ items: z.array(z.object({ name: z.string(), officer_role: z.string(), appointed_on: z.string().nullish(), resigned_on: z.string().nullish() }).passthrough()).default([]) }).passthrough();
const zCharges = z.object({ items: z.array(z.object({ charge_code: z.string().nullish(), status: z.string(), created_on: z.string().nullish(), persons_entitled: z.array(z.object({ name: z.string() }).passthrough()).nullish() }).passthrough()).default([]) }).passthrough();
const zFilings = z.object({ items: z.array(z.object({ date: z.string(), type: z.string(), description: z.string().nullish(), description_values: z.record(z.string(), z.unknown()).nullish() }).passthrough()).default([]) }).passthrough();

export function normalizeRegistry(c: z.infer<typeof zCompany>, o: z.infer<typeof zOfficers>, ch: z.infer<typeof zCharges>, f: z.infer<typeof zFilings>): RegistryData {
  return {
    status: c.company_status ?? null, incorporated: c.date_of_creation ?? null, type: c.type ?? null, sic: c.sic_codes ?? [],
    accountsNextDue: c.accounts?.next_due ?? null, accountsLastMadeUpTo: c.accounts?.last_accounts?.made_up_to ?? null, accountsOverdue: !!c.accounts?.overdue,
    officers: o.items.map(x => ({ name: x.name, role: x.officer_role, appointed: x.appointed_on ?? null, resigned: x.resigned_on ?? null })),
    charges: ch.items.map(x => ({ code: x.charge_code ?? "", status: x.status, created: x.created_on ?? null, entitled: (x.persons_entitled ?? []).map(p => p.name) })),
    filings: f.items.slice(0, 20).map(x => ({ date: x.date, type: x.type, description: (x.description ?? "").replace(/-/g, " ") })),
  };
}

/** What changed between two snapshots. Pure. */
export function diffRegistry(prev: RegistryData | null, next: RegistryData): RegistryChange[] {
  if (!prev) return [];
  const out: RegistryChange[] = [];
  if (prev.status !== next.status) out.push({ field: "status", detail: `Status ${prev.status ?? "?"} → ${next.status ?? "?"}` });
  if (!prev.accountsOverdue && next.accountsOverdue) out.push({ field: "accounts", detail: "Accounts now overdue" });
  if (prev.accountsLastMadeUpTo !== next.accountsLastMadeUpTo && next.accountsLastMadeUpTo) out.push({ field: "accounts", detail: `New accounts made up to ${next.accountsLastMadeUpTo}` });
  const key = (x: { name: string; role: string }) => `${x.name}|${x.role}`;
  const before = new Map(prev.officers.map(x => [key(x), x]));
  for (const x of next.officers) {
    const p = before.get(key(x));
    if (!p) out.push({ field: "officers", detail: `${x.role.replace(/-/g, " ")} appointed: ${x.name}${x.appointed ? ` (${x.appointed})` : ""}` });
    else if (!p.resigned && x.resigned) out.push({ field: "officers", detail: `${x.role.replace(/-/g, " ")} resigned: ${x.name} (${x.resigned})` });
  }
  const charges = new Map(prev.charges.map(c => [c.code, c]));
  for (const c of next.charges) {
    const p = charges.get(c.code);
    if (!p) out.push({ field: "charges", detail: `New charge ${c.code} (${c.status}) for ${c.entitled.join(", ") || "unnamed"}` });
    else if (p.status !== c.status) out.push({ field: "charges", detail: `Charge ${c.code}: ${p.status} → ${c.status}` });
  }
  return out;
}

export async function companyNumberOf(db: Db, orgId: string) {
  const [a] = await db.select({ value: entityAliases.value }).from(entityAliases).where(and(eq(entityAliases.entityType, "organization"), eq(entityAliases.entityId, orgId), eq(entityAliases.scheme, "companies_house")));
  return a?.value.replace(/\s+/g, "").toUpperCase() ?? null;
}

export async function latestSnapshot(db: Db, orgId: string) {
  const [s] = await db.select().from(registrySnapshots).where(eq(registrySnapshots.orgId, orgId)).orderBy(desc(registrySnapshots.fetchedAt)).limit(1);
  return s ?? null;
}

/** Fetches the record, stores a snapshot with changes, and notifies the workspace when anything changed. */
export async function checkCompaniesHouse(db: Db, apiKey: string | undefined, x: { mandateId: string; orgId: string; orgName: string; companyNumber: string }, fetchImpl?: typeof fetch) {
  if (!apiKey) throw new Error("Set COMPANIES_HOUSE_API_KEY (free from developer.company-information.service.gov.uk) to check UK companies.");
  const n = encodeURIComponent(x.companyNumber);
  const init = { headers: { authorization: `Basic ${btoa(`${apiKey}:`)}` } };
  const get = <T,>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, endpoint: string) => fetchJson(db, { provider: "companies_house", endpoint, url: `${BASE}${path}`, schema, init, fetchImpl, timeoutMs: 20_000 });
  const [c, o, ch, f] = await Promise.all([
    get(`/company/${n}`, zCompany, "company"), get(`/company/${n}/officers?items_per_page=100`, zOfficers, "officers"),
    get(`/company/${n}/charges?items_per_page=100`, zCharges, "charges").catch(() => ({ items: [] })), get(`/company/${n}/filing-history?items_per_page=25`, zFilings, "filings"),
  ]);
  const data = normalizeRegistry(c, o, ch as z.infer<typeof zCharges>, f);
  const prev = await latestSnapshot(db, x.orgId);
  const changes = diffRegistry(prev?.data ?? null, data);
  const [snap] = await db.insert(registrySnapshots).values({ mandateId: x.mandateId, orgId: x.orgId, source: "companies_house", companyNumber: x.companyNumber, data, changes }).returning();
  if (changes.length) {
    await db.insert(notifications).values({ mandateId: x.mandateId, category: "compliance", priority: "action", title: `${x.orgName}: ${changes.length} registry change(s) at Companies House`, body: changes.map(c => c.detail).join("\n").slice(0, 2000), entityType: "organization", entityId: x.orgId, link: `/companies/${x.orgId}` });
  }
  return snap;
}

/** Every organization with a companies_house alias and a previous snapshot older than a week (weekly job). */
export async function dueRegistryChecks(db: Db, now = new Date()) {
  const aliases = await db.select({ orgId: entityAliases.entityId, mandateId: entityAliases.mandateId, value: entityAliases.value }).from(entityAliases).where(and(eq(entityAliases.entityType, "organization"), eq(entityAliases.scheme, "companies_house")));
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const out: typeof aliases = [];
  for (const a of aliases) { const s = await latestSnapshot(db, a.orgId); if (!s || s.fetchedAt < weekAgo) out.push(a); }
  return out.slice(0, 20);
}

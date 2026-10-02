// Shared scanning engine (phase 15 §6). One lifecycle for every section: queued → running → completed / partial /
// failed / cancelled. A scan runs as bounded background steps (job "scan.step"), each resuming from a checkpoint, so
// no page request ever does discovery. Discovery goes through the existing provider adapters (ledger, rate limits,
// caches) and the existing find-or-create (strong-identifier dedupe, per-field provenance, conflicts kept, human values
// never overwritten). The result is reviewable records: nothing is enrolled, sent, or turned into an opportunity.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { accountQualifications, organizations, scanResults, scanRuns, type ProviderStatus, type ScanCounts, type ScanStage } from "@/db/schema";
import type { ApolloConfig } from "@/lib/sources/apollo";
import type { AiConfig } from "@/lib/ai/run";
import { PER_CALL, scanSpend, webDiscover, webOpportunities } from "./web";
import { searchOrganizations, searchPeople } from "@/lib/sources/apollo";
import { gleifDiscover } from "@/lib/sources/identity";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { attribute } from "@/lib/flow/commercial";
import { enqueue } from "@/lib/jobs/queue";
import { audience as audienceOf, registryTermsFor, type Audience } from "./audiences";
import { configFingerprint, creditCeiling, OPPORTUNITY_PROVIDERS, SCAN_PROVIDERS, zScanConfig, type ScanConfig, type ScanProvider, type ScanSection } from "./config";
import { opportunityPage, storeWebOpportunities, type OppProvider } from "./opportunities";
import { country, expandGeography } from "./countries";
import { RUBRIC_VERSION, screenOrganization, type OrgFacts } from "./criteria";

export class ScanBlocked extends Error {
  constructor(message: string, public guidance: { label: string; href: string }[]) { super(message); }
}

export type ScanDeps = { apollo: ApolloConfig | null; ai?: AiConfig | null; fetchImpl?: typeof fetch; aiClient?: import("@anthropic-ai/sdk").default };
type Run = typeof scanRuns.$inferSelect;
type Checkpoint = { stage?: "discover" | "people" | "finalize"; provider?: number; page?: number; term?: number; offset?: number; seen?: string[]; matched?: string[]; peopleOffset?: number; limited?: string[]; webCalls?: number; webNames?: string[] };

const EMPTY_COUNTS: ScanCounts = { found: 0, new: 0, existing: 0, duplicates: 0, matching: 0, partial: 0, excluded: 0, needsReview: 0, people: 0, usableRoutes: 0, providerFailures: 0 };
const ORGS_PER_STEP = 100;
const PEOPLE_ORGS_PER_STEP = 5;

/** Which requested providers can actually run, and why the others cannot. */
export function providerPlan(c: ScanConfig, deps: Pick<ScanDeps, "apollo" | "ai">) {
  const statuses: ProviderStatus[] = [];
  const usable: ScanProvider[] = [];
  for (const p of c.providers) {
    if ((p === "apollo_orgs" || p === "apollo_people") && !deps.apollo) { statuses.push({ provider: p, status: "not_connected", detail: "APOLLO_API_KEY is not set (Settings → Connections)." }); continue; }
    if (p === "web" && !deps.ai) { statuses.push({ provider: p, status: "not_connected", detail: "ANTHROPIC_API_KEY is not set (Settings → Claude)." }); continue; }
    if (p === "web" && c.researchBudgetUsd <= 0) { statuses.push({ provider: p, status: "skipped", detail: "Research budget is 0." }); continue; }
    if (p === "apollo_people" && c.maxPeoplePerOrg === 0) { statuses.push({ provider: p, status: "skipped", detail: "Maximum people per organization is 0." }); continue; }
    usable.push(p);
    statuses.push({ provider: p, status: "ok", detail: SCAN_PROVIDERS[p].note, calls: 0, credits: 0 });
  }
  return { usable, statuses, discovers: usable.some(p => SCAN_PROVIDERS[p].discovers && p !== "apollo_people") };
}

export async function startScan(db: Db, input: {
  mandateId: string; requestedBy: string; section: ScanSection; presetKey?: string | null; presetId?: string | null; presetName: string;
  config: ScanConfig; fallbackAccepted?: boolean; now?: Date;
}, deps: Pick<ScanDeps, "apollo" | "ai">): Promise<{ run: Run; reused: boolean }> {
  const now = input.now ?? new Date();
  const config = zScanConfig.parse(input.config);
  if (config.mode === "organizations" && !audienceOf(config.audience)) throw new Error(`Unknown audience "${config.audience}"`);
  const plan = providerPlan(config, deps);
  // External discovery (open web, Apollo) needs a connection; the public register, workspace records and opportunity
  // sources do not. When every requested external source is unavailable, the user must accept the fallback explicitly.
  const external = config.providers.filter(p => p === "web" || p === "apollo_orgs");
  if (external.length && !external.some(p => plan.usable.includes(p)) && !input.fallbackAccepted) {
    throw new ScanBlocked("No external discovery source is connected (open web needs ANTHROPIC_API_KEY; Apollo needs APOLLO_API_KEY). Connect one, or run on the public register and existing records (fallback).",
      [{ label: "Connect Claude", href: "/settings/claude" }, { label: "Connect Apollo", href: "/settings/connections" }]);
  }

  // One active scan per workspace + section + audience: a second click returns the running one.
  const [active] = await db.select().from(scanRuns).where(and(eq(scanRuns.mandateId, input.mandateId), eq(scanRuns.section, input.section), eq(scanRuns.audience, config.audience), config.objectiveId ? eq(scanRuns.objectiveId, config.objectiveId) : isNull(scanRuns.objectiveId), inArray(scanRuns.status, ["queued", "running"]))).limit(1);
  if (active) return { run: active, reused: true };
  // Idempotency: the same configuration on the same day is the same scan (failed or cancelled ones may be re-run).
  const key = `${input.section}:${configFingerprint(config)}:${now.toISOString().slice(0, 10)}`;
  const [same] = await db.select().from(scanRuns).where(and(eq(scanRuns.mandateId, input.mandateId), eq(scanRuns.idempotencyKey, key))).limit(1);
  if (same && !["failed", "cancelled"].includes(same.status)) return { run: same, reused: true };
  const idempotencyKey = same ? `${key}:${now.getTime()}` : key;

  const stages: ScanStage[] = [
    { key: "discover", label: config.mode === "opportunities" ? "Find and match opportunities" : "Discover and screen organizations", status: "pending", done: 0, total: null },
    { key: "people", label: "Find decision makers", status: plan.usable.includes("apollo_people") ? "pending" : "skipped", detail: plan.usable.includes("apollo_people") ? undefined : (plan.statuses.find(s => s.provider === "apollo_people")?.detail ?? "People search not requested") },
    { key: "finalize", label: "Record qualification status", status: "pending" },
  ];
  const [run] = await db.insert(scanRuns).values({
    mandateId: input.mandateId, presetId: input.presetId ?? null, presetName: input.presetName, section: input.section, audience: config.audience,
    objectiveId: config.objectiveId ?? null, config, status: "queued", stages, providers: plan.statuses, counts: EMPTY_COUNTS, creditCeiling: creditCeiling(config),
    checkpoint: { stage: "discover", provider: 0, page: 1, term: 0, offset: 0, seen: [], matched: [] }, idempotencyKey,
    fallbackAccepted: !!input.fallbackAccepted, requestedBy: input.requestedBy,
  }).returning();
  await enqueue(db, "scan.step", { runId: run.id, seq: 0 }, { dedupeKey: `scan:${run.id}:0`, now });
  return { run, reused: false };
}

export async function cancelScan(db: Db, mandateId: string, runId: string, by: string, now = new Date()) {
  const rows = await db.update(scanRuns).set({ status: "cancelled", cancelledAt: now.toISOString(), updatedAt: now.toISOString(), error: `Cancelled by ${by}` })
    .where(and(eq(scanRuns.id, runId), eq(scanRuns.mandateId, mandateId), inArray(scanRuns.status, ["queued", "running"]))).returning({ id: scanRuns.id });
  return rows.length === 1;
}

const setStage = (stages: ScanStage[], key: string, patch: Partial<ScanStage>) => stages.map(s => (s.key === key ? { ...s, ...patch } : s));
const bumpProvider = (ps: ProviderStatus[], provider: string, patch: Partial<ProviderStatus>, add?: { calls?: number; credits?: number }) =>
  ps.map(p => (p.provider === provider ? { ...p, ...patch, calls: (p.calls ?? 0) + (add?.calls ?? 0), credits: (p.credits ?? 0) + (add?.credits ?? 0) } : p));

type Found = { facts: OrgFacts; input: Parameters<typeof upsertOrganization>[2]; provider: ScanProvider; url: string | null; existingId?: string };

/** One bounded step. Returns true when more steps are needed (the job handler re-enqueues). */
export async function scanStep(db: Db, runId: string, deps: ScanDeps, now = new Date()): Promise<boolean> {
  const [run] = await db.select().from(scanRuns).where(eq(scanRuns.id, runId));
  if (!run || ["completed", "partial", "failed", "cancelled"].includes(run.status)) return false;
  const config = zScanConfig.parse(run.config);
  const cp = run.checkpoint as Checkpoint;
  let stages = run.stages, providers = run.providers; const counts = { ...EMPTY_COUNTS, ...run.counts }; let credits = run.creditsUsed;
  const limited = new Set(cp.limited ?? []);
  const plan = providerPlan(config, deps);
  const discoverers = plan.usable.filter(p => p !== "apollo_people");
  const t = now.toISOString();
  if (run.status === "queued") await db.update(scanRuns).set({ status: "running", startedAt: t, updatedAt: t }).where(eq(scanRuns.id, runId));
  const save = async (next: Checkpoint, extra: Partial<typeof scanRuns.$inferInsert> = {}) => {
    // Never resurrect a scan cancelled while this step ran.
    await db.update(scanRuns).set({ stages, providers, counts, creditsUsed: credits, checkpoint: { ...next, limited: [...limited] }, updatedAt: new Date().toISOString(), ...extra })
      .where(and(eq(scanRuns.id, runId), inArray(scanRuns.status, ["queued", "running"])));
  };

  if ((cp.stage ?? "discover") === "discover" && config.mode === "opportunities") {
    const sources = plan.usable.filter(p => (OPPORTUNITY_PROVIDERS as readonly string[]).includes(p) || p === "web") as (OppProvider | "web")[];
    const pi = cp.provider ?? 0, src = sources[pi];
    if (!src || counts.found >= config.maxOrganizations) {
      stages = setStage(stages, "discover", { status: "done", done: counts.found, total: counts.found });
      await save({ ...cp, stage: "finalize" });
      return true;
    }
    stages = setStage(stages, "discover", { status: "running", detail: SCAN_PROVIDERS[src].label, done: counts.found, total: null });
    let next: Checkpoint = { ...cp };
    try {
      if (src === "web") {
        const spent = await scanSpend(db, runId), calls = cp.webCalls ?? 0;
        if (spent >= config.researchBudgetUsd || !deps.ai) {
          limited.add(src);
          providers = bumpProvider(providers, src, { status: "limited", detail: `Research budget reached (${spent.toFixed(2)} of ${config.researchBudgetUsd}).` });
          next = { ...cp, provider: pi + 1, offset: 0 };
        } else {
          const items = await webOpportunities(db, deps.ai, runId, config, cp.webNames ?? [], deps.aiClient);
          const k = await storeWebOpportunities(db, run, config, items, now.toISOString().slice(0, 10), t);
          for (const key of ["found", "matching", "partial", "excluded", "needsReview"] as const) counts[key] += k[key];
          const after = await scanSpend(db, runId);
          providers = bumpProvider(providers, src, { detail: `${after.toFixed(2)} of ${config.researchBudgetUsd} research budget used.` }, { calls: 1 });
          const done = items.length === 0 || calls + 1 >= Math.ceil(config.maxOrganizations / PER_CALL) + 1;
          next = done ? { ...cp, provider: pi + 1, offset: 0, webCalls: 0 } : { ...cp, webCalls: calls + 1, webNames: [...(cp.webNames ?? []), ...items.map(x => x.title)] };
        }
        await save({ ...next, stage: "discover" });
        return true;
      }
      const r = await opportunityPage(db, run, config, src, cp.offset ?? 0, now.toISOString().slice(0, 10), t);
      providers = bumpProvider(providers, src, r.skipped ? { status: "skipped", detail: r.skipped } : {}, { calls: 1 });
      if (r.counts) for (const k of ["found", "matching", "partial", "excluded", "needsReview"] as const) counts[k] += r.counts[k];
      next = r.exhausted ? { ...cp, provider: pi + 1, offset: 0 } : { ...cp, offset: (cp.offset ?? 0) + 100 };
    } catch (err) {
      counts.providerFailures++;
      limited.add(src);
      providers = bumpProvider(providers, src, { status: "failed", detail: (err as Error).message.slice(0, 300) });
      next = { ...cp, provider: pi + 1, offset: 0 };
    }
    await save({ ...next, stage: "discover" });
    return true;
  }

  if (config.mode === "opportunities") {
    // Opportunity scans store no organization results, so finalizing is only the status.
    stages = setStage(stages, "finalize", { status: "done" });
    const anyFailed = providers.some(p => p.status === "failed") || limited.size > 0;
    await save(cp, { status: anyFailed ? "partial" : "completed", completedAt: t, retryGuidance: anyFailed ? "A source failed; results found are kept. Re-run later: existing results are not duplicated." : null });
    return false;
  }
  const a = audienceOf(config.audience);
  if (!a) throw new Error(`Unknown audience "${config.audience}"`);
  if ((cp.stage ?? "discover") === "discover") {
    const seen = new Set(cp.seen ?? []), matched = new Set(cp.matched ?? []);
    const pi = cp.provider ?? 0;
    const provider = discoverers[pi];
    if (!provider || seen.size >= config.maxOrganizations) {
      stages = setStage(stages, "discover", { status: "done", done: seen.size, total: seen.size });
      const nextStage = plan.usable.includes("apollo_people") && matched.size ? "people" : "finalize";
      if (nextStage === "people") stages = setStage(stages, "people", { status: "running", done: 0, total: matched.size });
      await save({ ...cp, stage: nextStage, peopleOffset: 0, seen: [...seen], matched: [...matched] });
      return true;
    }
    stages = setStage(stages, "discover", { status: "running", detail: `${SCAN_PROVIDERS[provider].label}` });
    let found: Found[] = [];
    let exhausted = false;
    let next: Checkpoint = { ...cp };
    try {
      if (provider === "existing") {
        const offset = cp.offset ?? 0;
        const rows = await db.select().from(organizations).where(and(eq(organizations.mandateId, run.mandateId), isNull(organizations.archivedAt), eq(organizations.testRecord, false)))
          .orderBy(organizations.createdAt).limit(ORGS_PER_STEP).offset(offset);
        const terms = new RegExp(`\\b(${[...a.orgTerms, ...config.terms].map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i");
        found = rows.filter(o => a.evidence.test(`${o.industry ?? ""} ${o.description ?? ""}`) || terms.test(`${o.name} ${o.industry ?? ""} ${o.description ?? ""}`))
          .map(o => ({ provider, url: null, existingId: o.id, input: { name: o.name }, facts: { name: o.name, country: o.country, industry: o.industry, description: o.description, headcount: o.headcount, domain: o.domain, website: o.website, source: "Workspace record" } }));
        exhausted = rows.length < ORGS_PER_STEP;
        next = { ...cp, offset: offset + ORGS_PER_STEP };
        providers = bumpProvider(providers, provider, {}, { calls: 1 });
      } else if (provider === "gleif") {
        const terms = [...registryTermsFor(a), ...config.terms];
        const geo = expandGeography(config.geography).map(c => country(c)?.iso2).filter(Boolean) as string[];
        const combos = (geo.length ? geo : [null]).flatMap(g => terms.map(term => ({ g, term })));
        const ti = cp.term ?? 0;
        const combo = combos[ti];
        if (!combo) exhausted = true;
        else {
          const res = await gleifDiscover(db, combo.term, combo.g, 1, 50, deps.fetchImpl);
          found = res.entities.map(e => ({ provider, url: `https://search.gleif.org/#/record/${e.lei}`, input: { name: e.legalName, lei: e.lei, country: country(e.country)?.iso3 ?? null, location: e.city },
            facts: { name: e.legalName, country: country(e.country)?.iso3 ?? null, industry: null, description: null, headcount: null, domain: null, website: null, source: "GLEIF" } }));
          next = { ...cp, term: ti + 1 };
          exhausted = ti + 1 >= combos.length;
          providers = bumpProvider(providers, provider, {}, { calls: 1 });
        }
      } else if (provider === "web" && deps.ai) {
        const spent = await scanSpend(db, runId);
        const calls = cp.webCalls ?? 0;
        if (spent >= config.researchBudgetUsd) { exhausted = true; limited.add(provider); providers = bumpProvider(providers, provider, { status: "limited", detail: `Research budget reached (${spent.toFixed(2)} of ${config.researchBudgetUsd}).` }); }
        else {
          const r = await webDiscover(db, deps.ai, runId, a, config, cp.webNames ?? [], deps.aiClient);
          found = r.candidates.map(x => {
            const iso = country(x.country)?.iso3 ?? null;
            return { provider, url: x.sources[0] ?? null, input: { name: x.name, website: x.website || null, domain: x.website || null, country: iso, description: x.evidence || null },
              facts: { name: x.name, country: iso, industry: null, description: x.evidence || null, headcount: null, domain: x.website || null, website: x.website || null, source: "Open web (cited page; verify)" } };
          });
          const after = await scanSpend(db, runId);
          providers = bumpProvider(providers, provider, { detail: `${after.toFixed(2)} of ${config.researchBudgetUsd} research budget used.` }, { calls: 1 });
          next = { ...cp, webCalls: calls + 1, webNames: [...(cp.webNames ?? []), ...r.candidates.map(x => x.name)] };
          exhausted = r.candidates.length === 0 || calls + 1 >= Math.ceil(config.maxOrganizations / PER_CALL) + 1;
        }
      } else if (provider === "apollo_orgs" && deps.apollo) {
        if (credits + 1 > run.creditCeiling) { exhausted = true; limited.add(provider); providers = bumpProvider(providers, provider, { status: "limited", detail: `Credit ceiling reached (${credits}/${run.creditCeiling}).` }); }
        else {
          const page = cp.page ?? 1;
          const locations = expandGeography(config.geography).map(c => country(c)?.name).filter(Boolean) as string[];
          const res = await searchOrganizations(db, deps.apollo, { q_organization_keyword_tags: [...a.orgTerms, ...config.terms].slice(0, 10), organization_locations: locations.length ? locations : undefined, page }, deps.fetchImpl);
          credits += 1;
          const orgs = [...res.organizations, ...res.accounts];
          found = orgs.filter(o => o.name).map(o => ({ provider, url: o.website_url ?? null, input: {
            name: o.name!, domain: o.primary_domain ?? null, website: o.website_url ?? null, country: country(o.country)?.iso3 ?? null, location: [o.city, o.state].filter(Boolean).join(", ") || null,
            industry: o.industry ?? null, headcount: o.estimated_num_employees ?? null, foundedYear: o.founded_year ?? null, description: o.short_description ?? null, linkedinUrl: o.linkedin_url ?? null, apolloOrgId: o.id ?? null,
          }, facts: { name: o.name!, country: country(o.country)?.iso3 ?? null, industry: o.industry ?? null, description: o.short_description ?? null, headcount: o.estimated_num_employees ?? null, domain: o.primary_domain ?? null, website: o.website_url ?? null, source: "Apollo" } }));
          const pages = res.pagination?.total_pages ?? page;
          exhausted = orgs.length === 0 || page >= pages;
          next = { ...cp, page: page + 1 };
          providers = bumpProvider(providers, provider, {}, { calls: 1, credits: 1 });
        }
      }
    } catch (err) {
      // A provider failure ends that provider for this run (partial result), never the whole scan.
      counts.providerFailures++;
      limited.add(provider);
      providers = bumpProvider(providers, provider, { status: "failed", detail: (err as Error).message.slice(0, 300) });
      exhausted = true;
    }

    for (const f of found.slice(0, ORGS_PER_STEP)) {
      if (seen.size >= config.maxOrganizations) break;
      let orgId = f.existingId, outcome: "new" | "existing" | "duplicate" = "existing", conflicts: string[] = [];
      if (!orgId) {
        const r = await upsertOrganization(db, run.mandateId, f.input, f.provider === "apollo_orgs" ? "apollo" : "other", { source: f.provider === "gleif" ? "GLEIF" : f.provider === "web" ? "Open web" : "Apollo", url: f.url ?? undefined, confidence: f.provider === "gleif" ? "high" : f.provider === "web" ? "low" : "medium" });
        orgId = r.row.id; outcome = r.created ? "new" : "existing"; conflicts = r.conflicts;
        // A record this scan created gets the scan as its original source (campaign economics); existing ones keep theirs.
        if (r.created) await attribute(db, run.mandateId, { entityType: "organization", entityId: orgId, channel: "scan", campaign: run.presetName || null, scanRunId: runId }, run.requestedBy);
        f.facts = { ...f.facts, country: r.row.country, industry: r.row.industry, description: r.row.description, headcount: r.row.headcount, domain: r.row.domain, website: r.row.website };
      }
      if (seen.has(orgId)) { counts.duplicates++; continue; }
      seen.add(orgId);
      const [testRow] = await db.select({ test: organizations.testRecord }).from(organizations).where(eq(organizations.id, orgId));
      const sc = screenOrganization(f.facts, a, config);
      const match = testRow?.test ? "excluded" : sc.match;
      const exclusionReason = testRow?.test ? "Test record" : sc.exclusionReason;
      await db.insert(scanResults).values({
        mandateId: run.mandateId, runId, entityType: "organization", entityId: orgId, name: f.facts.name, outcome: outcome, match, criteria: sc.criteria, missing: sc.missing,
        exclusionReason, provider: f.provider, sourceUrl: f.url, retrievedAt: t, identityConflicts: conflicts, review: match === "excluded" ? "rejected" : "needs_review",
      }).onConflictDoNothing();
      counts.found++;
      counts[outcome === "new" ? "new" : "existing"]++;
      if (match === "matches") { counts.matching++; matched.add(orgId); }
      else if (match === "partial") { counts.partial++; matched.add(orgId); }
      else if (match === "excluded") counts.excluded++;
      if (match !== "excluded") counts.needsReview++;
    }
    if (exhausted) next = { ...next, provider: pi + 1, page: 1, term: 0, offset: 0 };
    stages = setStage(stages, "discover", { status: "running", done: seen.size, total: null });
    await save({ ...next, stage: "discover", seen: [...seen], matched: [...matched] });
    return true;
  }

  if (cp.stage === "people") {
    const matched = cp.matched ?? [];
    const off = cp.peopleOffset ?? 0;
    const batch = matched.slice(off, off + PEOPLE_ORGS_PER_STEP);
    const titles = config.titles.length ? config.titles : a.titles;
    if (deps.apollo && batch.length) {
      const orgs = await db.select().from(organizations).where(inArray(organizations.id, batch));
      for (const o of orgs) {
        if (!o.domain) continue;
        try {
          const res = await searchPeople(db, deps.apollo, { q_organization_domains_list: [o.domain], person_titles: titles, person_seniorities: config.seniorities.length ? config.seniorities : a.seniorities, per_page: Math.min(25, config.maxPeoplePerOrg), page: 1 }, deps.fetchImpl);
          providers = bumpProvider(providers, "apollo_people", {}, { calls: 1 });
          for (const p of res.people.slice(0, config.maxPeoplePerOrg)) {
            const fullName = p.name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
            if (!fullName.trim()) continue;
            const r = await upsertContact(db, run.mandateId, { fullName, firstName: p.first_name, lastName: p.last_name, title: p.title, seniority: p.seniority, linkedinUrl: p.linkedin_url, apolloPersonId: p.id, orgId: o.id, country: country(p.country)?.iso3 ?? null }, "apollo", { source: "Apollo people search", confidence: "medium" });
            await db.insert(scanResults).values({ mandateId: run.mandateId, runId, entityType: "person", entityId: r.row.id, name: fullName, outcome: r.created ? "new" : "existing", match: "unknown",
              criteria: [{ key: "role", label: "Role", result: p.title ? "supported" : "unknown", evidence: p.title ? `Title "${p.title}" (Apollo)` : "No title returned", source: "Apollo" }],
              missing: r.row.email ? [] : ["Contact route (search returns no email; enrichment is separate and budgeted)"], provider: "apollo_people", retrievedAt: t, identityConflicts: r.conflicts }).onConflictDoNothing();
            counts.people++;
            if (r.row.email && (r.row.emailStatus === "verified_provider" || r.row.emailStatus === "verified_manual")) counts.usableRoutes++;
          }
        } catch (err) {
          counts.providerFailures++;
          providers = bumpProvider(providers, "apollo_people", { status: "failed", detail: (err as Error).message.slice(0, 300) });
          break;
        }
      }
    }
    const done = off + batch.length >= matched.length || providers.some(p => p.provider === "apollo_people" && p.status === "failed");
    stages = setStage(stages, "people", { status: done ? "done" : "running", done: Math.min(matched.length, off + batch.length), total: matched.length });
    await save({ ...cp, stage: done ? "finalize" : "people", peopleOffset: off + batch.length });
    return true;
  }

  // finalize: record qualification status for every non-excluded organization, never lowering a human decision.
  // (Reached for opportunity scans too; they store no organization results, so the loop is empty.)
  const results = await db.select().from(scanResults).where(and(eq(scanResults.runId, runId), eq(scanResults.entityType, "organization")));
  for (const r of results) {
    if (r.match === "excluded") continue;
    const status = r.match === "matches" ? "criteria_matched" : "discovered";
    const [q] = await db.select().from(accountQualifications).where(and(eq(accountQualifications.mandateId, run.mandateId), eq(accountQualifications.orgId, r.entityId)));
    if (!q) {
      await db.insert(accountQualifications).values({ mandateId: run.mandateId, orgId: r.entityId, audience: a.key, status, rubricVersion: RUBRIC_VERSION, criteria: r.criteria, entryOffer: a.entryOffer,
        dimensions: initialDimensions(r.criteria, t), firstRunId: runId, lastRunId: runId,
        history: [{ from: "", to: status, at: t, by: "scan", reason: `Scan "${run.presetName || a.label}"` }] }).onConflictDoNothing();
    } else {
      const upgrade = q.status === "discovered" && status === "criteria_matched";
      await db.update(accountQualifications).set({ lastRunId: runId, criteria: r.criteria, updatedAt: t,
        ...(upgrade ? { status, history: [...q.history, { from: q.status, to: status, at: t, by: "scan", reason: `Scan "${run.presetName || a.label}"` }] } : {}) })
        .where(eq(accountQualifications.id, q.id));
    }
  }
  stages = setStage(stages, "finalize", { status: "done" });
  const anyFailed = providers.some(p => p.status === "failed") || limited.size > 0;
  await save(cp, { status: anyFailed ? "partial" : "completed", completedAt: t,
    retryGuidance: anyFailed ? "Some providers failed or hit a limit; the records found are kept. Re-run after the limit resets or the connection is fixed: existing records are matched, not duplicated." : null });
  return false;
}

export function initialDimensions(criteria: { key: string; result: string; evidence: string }[], at: string) {
  const fit = criteria.filter(c => c.key === "audience" || c.key === "geography" || c.key === "size");
  const fitReading = fit.some(c => c.result === "contradicted") ? "weak" : fit.length && fit.every(c => c.result === "supported") ? "partial" : "unknown";
  return {
    accountFit: { reading: fitReading as "weak" | "partial" | "unknown", basis: fit.map(c => `${c.key}: ${c.result}`).join("; ") + " (machine screen; strong fit needs human review)", at, by: "scan" },
    buyingIntent: { reading: "unknown" as const, basis: "No sourced buying event recorded yet", at, by: "scan" },
    relationshipAccess: { reading: "unknown" as const, basis: "No relationship path recorded yet", at, by: "scan" },
    contactReadiness: { reading: "unknown" as const, basis: "No verified contact route yet", at, by: "scan" },
    evidenceConfidence: { reading: (fit.some(c => c.result === "supported") ? "partial" : "unknown") as "partial" | "unknown", basis: "Provider fields only; no dossier", at, by: "scan" },
    freshness: { reading: "strong" as const, basis: `Retrieved ${at.slice(0, 10)}`, at, by: "scan" },
  };
}

/** Job handler entry point. On the last failed attempt the run is marked failed with retry guidance. */
export async function runScanJob(db: Db, job: { payload: Record<string, unknown>; attempts: number; maxAttempts: number }, deps: ScanDeps, now: Date) {
  const runId = String(job.payload.runId), seq = Number(job.payload.seq ?? 0);
  try {
    const more = await scanStep(db, runId, deps, now);
    if (more && seq < 500) await enqueue(db, "scan.step", { runId, seq: seq + 1 }, { dedupeKey: `scan:${runId}:${seq + 1}`, now });
  } catch (err) {
    if (job.attempts + 1 >= job.maxAttempts) {
      await db.update(scanRuns).set({ status: "failed", error: (err as Error).message.slice(0, 500), completedAt: now.toISOString(), updatedAt: now.toISOString(),
        retryGuidance: "The scan stopped after repeated errors. Records already found are kept. Check Settings → Jobs for the error, then run the scan again." })
        .where(and(eq(scanRuns.id, runId), inArray(scanRuns.status, ["queued", "running"])));
    }
    throw err;
  }
}

export async function scanSummary(db: Db, mandateIds: string[]) {
  const ids = mandateIds.length ? mandateIds : ["-"];
  const [last] = await db.select().from(scanRuns).where(and(inArray(scanRuns.mandateId, ids), inArray(scanRuns.status, ["completed", "partial"]))).orderBy(sql`${scanRuns.completedAt} desc`).limit(1);
  const [{ active }] = await db.select({ active: sql<number>`count(*)` }).from(scanRuns).where(and(inArray(scanRuns.mandateId, ids), inArray(scanRuns.status, ["queued", "running"])));
  const [{ review }] = await db.select({ review: sql<number>`count(*)` }).from(scanResults).where(and(inArray(scanResults.mandateId, ids), eq(scanResults.review, "needs_review"), eq(scanResults.entityType, "organization")));
  return { last: last ?? null, active, review };
}

export type { Audience };

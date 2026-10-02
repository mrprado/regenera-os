import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { GenerateMenu } from "@/components/generate-menu";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { objectives, organizations, scanResults, scanRuns, OBJECTIVE_KINDS, type ObjectiveKind } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { aiConfig, apolloConfig } from "@/lib/config";
import { appDb } from "@/lib/db/scoped";
import { scanConfigFor } from "@/lib/flow/objectives";
import { SCAN_PROVIDERS, SCAN_STATUS_LABEL } from "@/lib/scan/config";
import { countryName } from "@/lib/scan/countries";
import { providerPlan } from "@/lib/scan/engine";
import { audience } from "@/lib/scan/audiences";
import { reviewResultAction } from "../../scan-actions";
import { scanObjectiveAction } from "../../flow-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Objective" };

const FIT = { matches: "Fits", partial: "Partial", unknown: "Unknown", excluded: "Excluded" } as const;

/** One objective: its criteria, what a scan would search (and what it cannot), and the reviewed shortlist. */
export default async function ObjectivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/objectives/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [o] = await db.select().from(objectives).where(and(eq(objectives.id, id), inArray(objectives.mandateId, user.scope.mandateIds.length ? user.scope.mandateIds : ["-"])));
  if (!o) notFound();
  const [org] = o.orgId ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, o.orgId)) : [];
  const runs = await db.select().from(scanRuns).where(eq(scanRuns.objectiveId, o.id)).orderBy(desc(scanRuns.createdAt)).limit(10);
  const latest = runs[0];
  const results = latest ? (await db.select().from(scanResults).where(eq(scanResults.runId, latest.id)).limit(300)).filter(x => x.match !== "excluded")
    .sort((a, b) => ["matches", "partial", "unknown"].indexOf(a.match) - ["matches", "partial", "unknown"].indexOf(b.match)) : [];
  const plan = scanConfigFor(o);
  const prov = "config" in plan ? providerPlan(plan.config, { apollo: apolloConfig(), ai: aiConfig() }) : null;
  const external = "config" in plan ? plan.config.providers.filter(p => p === "web" || p === "apollo_orgs") : [];
  const blocked = !!prov && external.length > 0 && !external.some(p => prov.usable.includes(p));
  const link = (x: (typeof results)[number]) => x.entityType === "organization" ? <Link href={`/companies/${x.entityId}?tab=qualification`}>{x.name}</Link>
    : x.entityType === "project" ? <Link href={`/projects/${x.entityId}`}>{x.name}</Link>
      : x.entityType === "funding_call" ? <Link href={`/funding/${x.entityId}`}>{x.name}</Link>
        : x.sourceUrl ? <a href={x.sourceUrl} target="_blank" rel="noreferrer">{x.name}</a> : x.name;
  return (
    <>
      <PageHeader title={o.title} actions={<><GenerateMenu entity="objective" id={o.id} /><Link className="btn" href="/objectives">All objectives</Link></>} />
      <Notice text={sp.notice} />
      <p className={ui.sub} style={{ marginTop: -4 }}>{OBJECTIVE_KINDS[o.kind as ObjectiveKind] ?? o.kind} · {org ? <Link href={`/companies/${org.id}?tab=profile`}>{org.name}</Link> : "Regenera"} · owner {o.owner} · criteria from: {o.source || "not recorded"}</p>
      <div className={r.grid}>
        <div>
          <section className={r.panel}>
            <p className={r.panelTitle}><span>Shortlist</span><span>{latest ? `${SCAN_STATUS_LABEL[latest.status]} · ${latest.createdAt.slice(0, 10)}` : "No scan yet"}</span></p>
            {latest && <p className={ui.sub}>Potential matches until a person checks eligibility and commercial terms. <Link href={`/scans/${latest.id}`}>Full run detail</Link>.</p>}
            {results.length === 0 ? <p className={r.empty}>{latest ? "No candidates matched yet." : "Run the scan to build a shortlist."}</p> : (
              <ul className={r.timeline}>{results.slice(0, 40).map(x => (
                <li key={x.id}>
                  <span className={r.when}>{FIT[x.match]}{x.confidence ? ` · ${x.confidence} confidence` : ""}</span>
                  <span>
                    <b>{link(x)}</b>
                    <span className={ui.sub}>{x.criteria.filter(c => c.key !== "evidence").map(c => `${c.label}: ${c.result === "supported" ? "fits" : c.result === "contradicted" ? "mismatch" : "unknown"}`).join(" · ")}</span>
                    {x.caveats.length > 0 && <span className={ui.sub}>{x.caveats.join(" ")}</span>}
                    {x.nextAction && <span className={ui.sub}>Next: {x.nextAction}</span>}
                    {x.review === "needs_review" ? (
                      <span className={ui.rowActions}>
                        <form action={reviewResultAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="decision" value="accepted" /><button className={ui.miniBtn} type="submit">Shortlist</button></form>
                        <form action={reviewResultAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="decision" value="rejected" /><input name="reason" placeholder="Why not" aria-label={`Reason to dismiss ${x.name}`} style={{ height: 26, border: "1px solid var(--line)", borderRadius: 6, padding: "0 6px", fontSize: 12 }} /><button className={ui.miniBtn} type="submit">Dismiss</button></form>
                      </span>
                    ) : <span className={ui.chipMuted}>{x.review === "accepted" ? "Shortlisted" : "Dismissed"}</span>}
                  </span>
                </li>
              ))}</ul>
            )}
          </section>
          {runs.length > 1 && (
            <section className={r.panel}>
              <p className={r.panelTitle}>Earlier scans</p>
              <ul className={r.timeline}>{runs.slice(1).map(x => <li key={x.id}><span className={r.when}>{x.createdAt.slice(0, 10)}</span><span><Link href={`/scans/${x.id}`}>{SCAN_STATUS_LABEL[x.status]}</Link> · {x.counts.found ?? 0} found</span></li>)}</ul>
            </section>
          )}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Criteria</p>
            <dl className={r.kv}>
              <dt>Outcome</dt><dd>{o.desiredOutcome || "Not recorded"}</dd>
              <dt>Capabilities</dt><dd>{o.capabilities.join(", ") || "Not recorded"}</dd>
              <dt>Geography</dt><dd>{o.geography.map(countryName).join(", ") || "Any"}</dd>
              <dt>Size</dt><dd>{o.sizeMin != null || o.sizeMax != null ? `${o.sizeMin ?? 0}–${o.sizeMax ?? "any"} ${o.sizeUnit ?? ""}` : "Any"}</dd>
              <dt>Stages</dt><dd>{o.stages.join(", ") || "Any"}</dd>
              <dt>Exclusions</dt><dd>{o.exclusions.join(", ") || "None"}</dd>
              {o.targetAudience && <><dt>Audience</dt><dd>{audience(o.targetAudience)?.label}</dd></>}
              <dt>Timing</dt><dd>{o.timing || "Not recorded"}</dd>
            </dl>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Scan scope</p>
            {"blocked" in plan ? <p className={ui.notice}>{plan.blocked}</p> : (
              <>
                <p className={ui.sub} style={{ marginTop: 0 }}>{plan.config.mode === "opportunities" ? "Searches for opportunities (not organizations) and matches each against these criteria." : `Searches for ${audience(plan.config.audience)?.label ?? "organizations"}.`} Coverage is limited to the sources below: never &quot;all opportunities&quot;.</p>
                <ul className={ui.sub} style={{ paddingLeft: 16 }}>{prov!.statuses.map(s => <li key={s.provider}><b>{SCAN_PROVIDERS[s.provider as keyof typeof SCAN_PROVIDERS]?.label}</b>: {s.status === "ok" ? "will run" : s.status.replace("_", " ")}. {s.status === "ok" ? SCAN_PROVIDERS[s.provider as keyof typeof SCAN_PROVIDERS]?.note : s.detail}</li>)}</ul>
                <p className={ui.sub}>Result limit {plan.config.maxOrganizations}; open-web research budget ${plan.config.researchBudgetUsd}. Results are reviewed here; nobody is contacted.</p>
                <form action={scanObjectiveAction}>
                  <input type="hidden" name="id" value={o.id} />
                  {blocked && <label className={ui.sub} style={{ display: "flex", gap: 6 }}><input type="checkbox" name="fallback" /> No external source is connected: run on workspace records and public registers only.</label>}
                  <button className="btn btn--primary" type="submit">{plan.config.mode === "opportunities" ? "Find matching opportunities" : "Find matching organizations"}</button>
                </form>
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

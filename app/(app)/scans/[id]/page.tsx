import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { scanResults, scanRuns } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { audience } from "@/lib/scan/audiences";
import { SCAN_PROVIDERS, SCAN_SECTIONS, SCAN_STATUS_LABEL, type ScanSection } from "@/lib/scan/config";
import { cancelScanAction, reviewResultAction } from "../../scan-actions";
import { ScanProgress } from "../scan-progress";
import s from "../scans.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan" };

const MATCH_LABEL = { matches: "Matches criteria", partial: "Partial match", unknown: "Not enough evidence", excluded: "Excluded" } as const;
const RESULT_LABEL = { supported: "Supported", contradicted: "Contradicted", unknown: "Unknown" } as const;

export default async function ScanRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const user = await requireOsUser(`/scans/${id}`);
  const sp = await searchParams;
  const db = appDb();
  const [run] = await db.select().from(scanRuns).where(and(eq(scanRuns.id, id), inArray(scanRuns.mandateId, user.scope.mandateIds.length ? user.scope.mandateIds : ["-"])));
  if (!run) notFound();
  const tab = sp.tab === "people" || sp.tab === "excluded" ? sp.tab : "results";
  const rows = await db.select().from(scanResults).where(eq(scanResults.runId, id)).orderBy(asc(scanResults.name)).limit(600);
  const orgs = rows.filter(x => x.entityType === "organization");
  const shown = tab === "people" ? rows.filter(x => x.entityType === "person") : tab === "excluded" ? orgs.filter(x => x.match === "excluded") : orgs.filter(x => x.match !== "excluded")
    .sort((a, b) => ["matches", "partial", "unknown"].indexOf(a.match) - ["matches", "partial", "unknown"].indexOf(b.match));
  const active = run.status === "queued" || run.status === "running";
  const c = run.counts;
  const a = audience(run.audience);

  return (
    <>
      <PageHeader title={run.presetName || a?.label || "Scan"} actions={<><Link className="btn" href="/scans?tab=runs">All scans</Link>{active && <form action={cancelScanAction}><input type="hidden" name="id" value={run.id} /><button className="btn" type="submit">Cancel scan</button></form>}</>} />
      <Notice text={sp.notice} />
      <p className={s.lead}><span className={ui.chip}>{SCAN_STATUS_LABEL[run.status]}</span> {SCAN_SECTIONS[run.section as ScanSection] ?? run.section} · {a?.label} · requested by {run.requestedBy}{run.startedAt ? ` · started ${run.startedAt.slice(0, 16).replace("T", " ")} UTC` : ""}{run.completedAt ? ` · finished ${run.completedAt.slice(0, 16).replace("T", " ")} UTC` : ""}</p>
      {active && <ScanProgress id={run.id} />}
      {run.error && <p className={ui.notice} role="alert">{run.error}</p>}
      {run.retryGuidance && <p className={ui.notice}>{run.retryGuidance}</p>}

      <section className={s.counts} aria-label="Results">
        {([["Found", c.found], ["New records", c.new], ["Already in workspace", c.existing], ["Duplicates merged", c.duplicates], ["Match criteria", c.matching], ["Partial", c.partial], ["Excluded", c.excluded], ["Need review", c.needsReview], ["People found", c.people], ["Usable contact routes", c.usableRoutes], ["Provider failures", c.providerFailures]] as const).map(([k, v]) => <div key={k}><b>{v ?? 0}</b><span>{k}</span></div>)}
        <div><b>{run.creditsUsed}/{run.creditCeiling}</b><span>Credits used / ceiling</span></div>
      </section>

      <div className={r.grid}>
        <div>
          <nav className={ui.tabs} aria-label="Result views">
            <Link className={`${ui.tab} ${tab === "results" ? ui.tabActive : ""}`} href={`/scans/${id}`}>Organizations to review ({orgs.filter(x => x.match !== "excluded").length})</Link>
            <Link className={`${ui.tab} ${tab === "people" ? ui.tabActive : ""}`} href={`/scans/${id}?tab=people`}>People ({rows.filter(x => x.entityType === "person").length})</Link>
            <Link className={`${ui.tab} ${tab === "excluded" ? ui.tabActive : ""}`} href={`/scans/${id}?tab=excluded`}>Excluded ({orgs.filter(x => x.match === "excluded").length})</Link>
          </nav>
          {shown.length === 0 ? <p className={r.empty}>{active ? "Results appear here as the scan runs." : tab === "people" ? "No people search ran in this scan (needs Apollo and a people limit above 0)." : "Nothing in this view."}</p> : (
            <ul className={s.results}>{shown.map(x => (
              <li key={x.id} data-match={x.match}>
                <div className={s.resultHead}>
                  <b><Link href={x.entityType === "person" ? `/people/${x.entityId}` : `/companies/${x.entityId}?tab=qualification`}>{x.name}</Link></b>
                  <span className={s.match}>{MATCH_LABEL[x.match]}</span>
                  <span className={ui.sub}>{x.outcome === "new" ? "New record" : x.outcome === "existing" ? "Already in workspace" : x.outcome} · {SCAN_PROVIDERS[x.provider as keyof typeof SCAN_PROVIDERS]?.label ?? x.provider} · retrieved {x.retrievedAt.slice(0, 10)}{x.sourceUrl ? <> · <a href={x.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</span>
                </div>
                <ul className={s.criteria}>{x.criteria.map(k => <li key={k.key} data-result={k.result}><span>{RESULT_LABEL[k.result]}</span> <b>{k.label}</b>: {k.evidence}{k.source ? ` (${k.source})` : ""}</li>)}</ul>
                {x.exclusionReason && <p className={ui.sub}>Excluded: {x.exclusionReason}</p>}
                {x.identityConflicts.length > 0 && <p className={ui.sub}>Identity conflicts to check: {x.identityConflicts.join("; ")}</p>}
                {x.missing.length > 0 && <details className={s.missing}><summary>{x.missing.length} facts still unknown</summary><p>{x.missing.join(" · ")}</p></details>}
                {x.entityType === "organization" && (
                  <div className={ui.rowActions}>
                    {x.review === "needs_review" ? <>
                      <form action={reviewResultAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="decision" value="accepted" /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">Accept for review</button></form>
                      <form action={reviewResultAction} className={s.reject}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="decision" value="rejected" /><input name="reason" placeholder="Why not (kept on record)" aria-label={`Reason to reject ${x.name}`} /><button className={ui.miniBtn} type="submit">Reject</button></form>
                    </> : <span className={ui.chipMuted}>{x.review === "accepted" ? `Accepted by ${x.reviewedBy ?? "reviewer"}` : `Rejected${x.reviewedBy ? ` by ${x.reviewedBy}` : ""}`}</span>}
                  </div>
                )}
              </li>
            ))}</ul>
          )}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Stages</p>
            <ol className={s.stages}>{run.stages.map(st => <li key={st.key} data-status={st.status}><b>{st.label}</b> <span>{st.status}{st.done != null ? ` · ${st.done}${st.total != null ? ` of ${st.total}` : ""}` : ""}</span>{st.detail && <span className={ui.sub}>{st.detail}</span>}</li>)}</ol>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>Providers</p>
            <ul className={s.providers}>{run.providers.map(p => <li key={p.provider} data-status={p.status}><b>{SCAN_PROVIDERS[p.provider as keyof typeof SCAN_PROVIDERS]?.label ?? p.provider}</b> <span className={s.pstatus}>{p.status.replace("_", " ")}</span><span className={ui.sub}>{p.calls ?? 0} calls · {p.credits ?? 0} credits. {p.status === "ok" ? "" : p.detail}</span></li>)}</ul>
          </section>
          <section className={r.panel}>
            <p className={r.panelTitle}>What happens next</p>
            <p className={ui.sub}>Accepting marks an organization Human reviewed; it is not yet a qualified lead. Open it to record account fit, buying intent, access and contact readiness, then set it Ready for outreach. Nothing here sends a message or creates an opportunity.</p>
          </section>
        </aside>
      </div>
    </>
  );
}

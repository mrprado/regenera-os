import { Fragment } from "react";
import { desc } from "drizzle-orm";
import { clientErrors } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { isOwner } from "@/lib/db/scoped";
import { jobsOverview } from "@/lib/settings";
import { appDb } from "@/lib/db/scoped";
import { getState } from "@/lib/state";
import { queueHealth, scheduleHealth } from "@/lib/jobs/health";
import { fmtLocal } from "@/lib/time/zone";
import { retryJob, runJobsNow } from "../actions";
import styles from "../settings.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jobs" };

const STATUS_CLASS: Record<string, string> = { done: styles.pillOk, dead: styles.pillWarn, queued: styles.pillMuted, running: "" };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return mins < 1 ? "just now" : mins < 120 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/jobs");
  const params = await searchParams;
  const { counts, recent, schedules, lastTick, lastHeartbeat, stale } = await jobsOverview();
  const parse = (v: string | null) => { try { return v ? JSON.parse(v) as Record<string, unknown> : null; } catch { return null; } };
  const backup = parse(await getState(appDb(), "last_backup"));
  const check = parse(await getState(appDb(), "last_backup_check"));
  const [q, sched] = await Promise.all([queueHealth(appDb()), scheduleHealth(appDb())]);
  // Browser errors from signed-in sessions (phase 20): owners only, last 30.
  const browserErrors = isOwner(user.scope) ? await appDb().select().from(clientErrors).orderBy(desc(clientErrors.createdAt)).limit(30) : [];
  const STATE_LABEL = { ok: "Completed", never: "Never completed", failing: "Failing", overdue: "Queued, not completed", paused: "Paused" } as const;

  return (
    <>
      <h2>Jobs</h2>
      {params.ran && <p className={`${styles.notice} ${styles.noticeOk}`}>Ran one tick.</p>}
      <p className={`${styles.notice} ${backup ? styles.noticeOk : ""}`}>
        Backups: {backup ? `last nightly export ${String(backup.day)} (${String(backup.tables)} tables, ${String(backup.rows)} rows, kept 30 days in R2)` : "no backup yet (runs nightly at 02:30 Pacific)"}.
        {" "}Read-back check: {check ? `${check.ok ? "passed" : "FAILED"} on ${String(check.at).slice(0, 10)}${check.ok ? "" : `: ${(check.problems as string[]).slice(0, 2).join("; ")}`}` : "not run yet (monthly)"}.
        {" "}Full restore test: <code>node scripts/restore-backup.mjs &lt;folder&gt;</code>.
      </p>
      {stale && <p className={styles.notice}>The scheduler has not called /api/jobs/tick in the last 30 minutes. Last tick: {ago(lastTick)}.</p>}

      <div className={styles.grid}>
        <article className={styles.card}>
          <p className="eyebrow">Scheduler</p>
          <dl className={styles.meta}>
            <dt>Last tick</dt><dd>{ago(lastTick)}</dd>
            <dt>Heartbeat</dt><dd>{ago(lastHeartbeat)}</dd>
          </dl>
          {isOwner(user.scope) && <form action={runJobsNow}><button className="btn btn--primary" type="submit">Run jobs now</button></form>}
        </article>
        <article className={styles.card}>
          <p className="eyebrow">Queue</p>
          <dl className={styles.meta}>
            {(["queued", "running", "done", "dead"] as const).map(s => <Fragment key={s}><dt>{s}</dt><dd>{counts[s] ?? 0}</dd></Fragment>)}
            <dt>Due and waiting</dt><dd>{q.dueWaiting}{q.oldestDueAt ? `, oldest due ${fmtLocal(q.oldestDueAt)}` : ""}</dd>
            <dt>Retrying</dt><dd>{q.retrying}</dd>
            <dt>Expired leases</dt><dd>{q.expiredLeases}{q.expiredLeases ? " (reclaimed on the next tick)" : ""}</dd>
          </dl>
        </article>
      </div>

      <h3>Schedules</h3>
      <p className={styles.notice}>Queued is not completed: a schedule is working only when its jobs reach Completed. Times are Pacific; storage is UTC.</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Job</th><th>Cadence (Pacific)</th><th>State</th><th>Next queued</th><th>Last queued</th><th>Last completed</th><th>Last failure</th></tr></thead>
          <tbody>
            {schedules.length === 0 && <tr><td colSpan={7}>Created on the first tick.</td></tr>}
            {[...sched].sort((a, b) => a.jobType.localeCompare(b.jobType)).map(s => (
              <tr key={s.jobType}><td className={styles.mono}>{s.jobType}</td><td className={styles.mono}>{s.cadence}</td>
                <td><span className={`${styles.pill} ${s.state === "ok" ? styles.pillOk : s.state === "failing" || s.state === "overdue" ? styles.pillWarn : styles.pillMuted}`}>{STATE_LABEL[s.state]}</span>{s.waiting ? <> · {s.waiting} waiting</> : null}</td>
                <td>{fmtLocal(s.nextRunAt)}</td><td>{fmtLocal(s.lastQueuedAt)}</td><td>{fmtLocal(s.lastCompletedAt)}</td><td>{s.lastFailedAt ? <>{fmtLocal(s.lastFailedAt)}{s.lastError ? <span className={styles.mono}> · {s.lastError.slice(0, 120)}</span> : null}</> : "none"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Recent jobs</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Type</th><th>Status</th><th>Attempts</th><th>Updated</th><th>Last error</th><th /></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={6}>No jobs yet.</td></tr>}
            {recent.map(j => (
              <tr key={j.id}>
                <td className={styles.mono}>{j.type}</td>
                <td><span className={`${styles.pill} ${STATUS_CLASS[j.status]}`}>{j.status}</span></td>
                <td>{j.attempts}/{j.maxAttempts}</td>
                <td>{ago(j.updatedAt)}</td>
                <td>{j.lastError ?? ""}</td>
                <td>
                  {j.status === "dead" && isOwner(user.scope) && (
                    <form action={retryJob}><input type="hidden" name="id" value={j.id} /><button className={styles.linkButton} type="submit">Retry</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner(user.scope) && <div>
        <h3>Browser errors</h3>
        {browserErrors.length === 0 ? <p>None reported. Errors in signed-in sessions (including Atlas map errors) appear here.</p> :
          <table><thead><tr><th>When</th><th>Where</th><th>Kind</th><th>Message</th><th>Who</th></tr></thead><tbody>
            {browserErrors.map(x => <tr key={x.id}><td>{ago(x.createdAt)}</td><td>{x.path}</td><td>{x.kind}</td><td title={x.stack}>{x.message}</td><td>{x.email ?? ""}</td></tr>)}
          </tbody></table>}
      </div>}
    </>
  );
}

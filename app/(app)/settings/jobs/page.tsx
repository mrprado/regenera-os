import { Fragment } from "react";
import { requireOsUser } from "@/lib/auth";
import { isOwner } from "@/lib/db/scoped";
import { jobsOverview } from "@/lib/settings";
import { appDb } from "@/lib/db/scoped";
import { getState } from "@/lib/state";
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

  return (
    <>
      <h2>Jobs</h2>
      {params.ran && <p className={`${styles.notice} ${styles.noticeOk}`}>Ran one tick.</p>}
      <p className={`${styles.notice} ${backup ? styles.noticeOk : ""}`}>
        Backups: {backup ? `last nightly export ${String(backup.day)} (${String(backup.tables)} tables, ${String(backup.rows)} rows, kept 30 days in R2)` : "no backup yet (runs nightly at 02:30 ET)"}.
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
          </dl>
        </article>
      </div>

      <h3>Schedules</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Job</th><th>Cadence (ET)</th><th>Next run</th><th>Last run</th></tr></thead>
          <tbody>
            {schedules.length === 0 && <tr><td colSpan={4}>Created on the first tick.</td></tr>}
            {schedules.map(s => (
              <tr key={s.id}><td className={styles.mono}>{s.jobType}</td><td className={styles.mono}>{s.cadence}</td><td>{s.nextRunAt}</td><td>{s.lastRunAt ?? "never"}</td></tr>
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
    </>
  );
}

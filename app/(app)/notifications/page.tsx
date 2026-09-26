import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { events, notificationMutes, stageGates, triggerRules } from "@/db/schema";
import { NOTIFICATION_CATEGORIES } from "@/db/events";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner, mandateCondition } from "@/lib/db/scoped";
import { EVENT_TYPES, openNotifications } from "@/lib/events/engine";
import { PLAYBOOK_LIBRARY } from "@/lib/playbooks/library";
import { PROJECT_STAGES } from "@/lib/projects/vocab";
import { createRuleAction, dispatchNowAction, gateAction, muteAction, notificationAction, readAllAction, ruleToggleAction } from "../notification-actions";
import styles from "../projects/projects.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

const TABS = [["inbox", "Inbox"], ["rules", "Trigger rules"], ["gates", "Stage gates"], ["events", "Event log"]] as const;
const PRI_COLOR: Record<string, string | undefined> = { critical: "#b0432f", action: "var(--heading)", information: "var(--text-muted)" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/notifications");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "inbox";
  const owner = isOwner(user.scope);
  const db = appDb();
  const list = tab === "inbox" ? await openNotifications(db, user.scope.mandateIds, user.email) : [];
  const [rules, gates, log, mutes] = await Promise.all([
    tab === "rules" ? db.select().from(triggerRules).where(mandateCondition(user.scope, triggerRules.mandateId)).orderBy(desc(triggerRules.isSystem)) : [],
    tab === "gates" ? db.select().from(stageGates).where(mandateCondition(user.scope, stageGates.mandateId)) : [],
    tab === "events" ? db.select().from(events).where(mandateCondition(user.scope, events.mandateId)).orderBy(desc(events.at)).limit(100) : [],
    db.select().from(notificationMutes).where(eq(notificationMutes.email, user.email)),
  ]);

  return (
    <>
      <PageHeader title="Notifications" actions={tab === "inbox" && list.some(n => !n.readAt) ? <form action={readAllAction}><button className="btn" type="submit">Mark all read</button></form> : null} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Notification sections">{TABS.map(([k, l]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={`/notifications?tab=${k}`}>{l}</Link>)}</nav>

      {tab === "inbox" && (
        <section className={r.panel}>
          {list.length === 0 ? <p className={r.empty}>Nothing open. Trigger rules turn events (stage changes, introducer registrations, playbook failures, portal messages, intake) into notifications here.</p> : (
            <table className={ui.table}><tbody>{list.map(n => (
              <tr key={n.id} style={{ opacity: n.readAt ? 0.7 : 1 }}>
                <td><span className={ui.chip} style={{ color: PRI_COLOR[n.priority] }}>{n.priority}</span> <span className={ui.chip}>{n.category}</span> {n.link ? <Link href={n.link}><b>{n.title}</b></Link> : <b>{n.title}</b>}
                  {n.body && <span className={ui.sub} style={{ display: "block" }}>{n.body}</span>}
                  <span className={ui.sub} style={{ display: "block" }}>{n.createdAt.slice(0, 16).replace("T", " ")}{n.assignedTo ? ` · assigned to ${n.assignedTo}` : ""}{n.recipient ? ` · for ${n.recipient}` : ""}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {!n.readAt && <form action={notificationAction} style={{ display: "inline" }}><input type="hidden" name="notificationId" value={n.id} /><input type="hidden" name="op" value="read" /><button className={ui.miniBtn} type="submit">Read</button></form>}{" "}
                  <form action={notificationAction} style={{ display: "inline" }}><input type="hidden" name="notificationId" value={n.id} /><input type="hidden" name="op" value="resolve" /><button className={ui.miniBtn} type="submit">Resolve</button></form>{" "}
                  <form action={notificationAction} style={{ display: "inline" }}><input type="hidden" name="notificationId" value={n.id} /><input type="hidden" name="op" value="snooze" /><input type="hidden" name="days" value="1" /><button className={ui.miniBtn} type="submit">Snooze 1d</button></form>{" "}
                  <form action={notificationAction} style={{ display: "inline" }}><input type="hidden" name="notificationId" value={n.id} /><input type="hidden" name="op" value="assign" /><button className={ui.miniBtn} type="submit">Assign to me</button></form>
                </td>
              </tr>
            ))}</tbody></table>
          )}
        </section>
      )}

      {tab === "rules" && (
        <div className={r.grid}>
          <section className={r.panel}>
            <p className={r.panelTitle}>Trigger rules</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>When an event happens and its conditions match, the rule notifies, creates a task, starts a playbook run or queues a job. Events are processed every five minutes.</p>
            <table className={ui.table}><tbody>{rules.map(x => (
              <tr key={x.id}><td><b>{x.name}</b>{x.isSystem ? <span className={ui.chip} style={{ marginLeft: 6 }}>default</span> : null}
                <span className={ui.sub} style={{ display: "block" }}>When {x.eventType}{x.conditions.length ? ` and ${x.conditions.map(c => `${c.field} ${c.op} ${c.value}`).join(", ")}` : ""} → {x.actions.map(a => a.type === "notify" ? `notify (${a.priority})` : a.type === "task" ? "task" : a.type === "playbook" ? `playbook ${a.key}` : `job ${a.job}`).join(", ")}</span>
                <span className={ui.sub} style={{ display: "block" }}>{x.runs} runs{x.lastRunAt ? ` · last ${x.lastRunAt.slice(0, 16).replace("T", " ")}: ${x.lastResult}` : ""}</span></td>
                <td>{owner ? <form action={ruleToggleAction}><input type="hidden" name="ruleId" value={x.id} /><button className={ui.miniBtn} type="submit">{x.enabled ? "Disable" : "Enable"}</button></form> : (x.enabled ? "On" : "Off")}</td></tr>
            ))}</tbody></table>
          </section>
          <aside>
            {owner && (
              <section className={r.panel}>
                <p className={r.panelTitle}>New rule</p>
                <form action={createRuleAction} className={styles.stack}>
                  <label>Name<input name="name" required minLength={3} /></label>
                  <label>When<select name="eventType">{EVENT_TYPES.map(e => <option key={e} value={e}>{e}</option>)}</select></label>
                  <label>Only if field<input name="field" placeholder="e.g. to, status, kind" /></label>
                  <label>equals<input name="value" placeholder="e.g. construction" /></label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="notify" defaultChecked /> Notify</label>
                  <label>Priority<select name="priority" defaultValue="action"><option value="critical">Critical</option><option value="action">Action</option><option value="information">Information</option></select></label>
                  <label>Category<select name="category" defaultValue="project">{NOTIFICATION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="task" /> Create a task</label>
                  <label>Start playbook<select name="playbook" defaultValue=""><option value="">None</option>{PLAYBOOK_LIBRARY.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
                  <label>Title (use {"{name}"} for the entity name)<input name="title" /></label>
                  <button className="btn btn--primary" type="submit">Create</button>
                </form>
              </section>
            )}
            <section className={r.panel}>
              <p className={r.panelTitle}>Mute categories for me</p>
              {NOTIFICATION_CATEGORIES.map(c => {
                const muted = mutes.some(m => m.category === c);
                return <form key={c} action={muteAction} className={styles.inline} style={{ marginBottom: 4 }}><input type="hidden" name="category" value={c} /><input type="hidden" name="mute" value={muted ? "" : "on"} /><span style={{ fontSize: 13, minWidth: 100 }}>{c}</span><button className={ui.miniBtn} type="submit">{muted ? "Unmute" : "Mute"}</button></form>;
              })}
              <p className={ui.sub}>Mutes apply to notifications addressed to you; team-wide notifications still appear.</p>
            </section>
          </aside>
        </div>
      )}

      {tab === "gates" && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Stage gates</p>
          <p className={ui.sub} style={{ marginTop: 0 }}>Entry requirements for project stages, checked against records. Blocking gates can be overridden only by an owner, with a reason that is audited. Nothing narrative (including AI output) can satisfy a gate.</p>
          {gates.length === 0 ? <p className={r.empty}>No gates yet (they are created with the reference data on the next job tick).</p> : (
            <table className={ui.table}><tbody>{gates.map(g => (
              <tr key={g.id}><td><b>{PROJECT_STAGES[g.toStage as keyof typeof PROJECT_STAGES] ?? g.toStage}</b><ul style={{ margin: "4px 0 0 18px", fontSize: 13 }}>{g.conditions.map(c => <li key={c.id}>{c.text}</li>)}</ul></td>
                <td>{owner ? <form action={gateAction} className={styles.stack}><input type="hidden" name="gateId" value={g.id} /><select name="enforce" defaultValue={g.enforce} aria-label="Enforcement"><option value="block">Block</option><option value="warn">Warn</option></select><label style={{ fontSize: 12 }}><input type="checkbox" name="enabled" defaultChecked={g.enabled} /> Enabled</label><button className={ui.miniBtn} type="submit">Save</button></form> : `${g.enforce}${g.enabled ? "" : " (off)"}`}</td></tr>
            ))}</tbody></table>
          )}
        </section>
      )}

      {tab === "events" && (
        <section className={r.panel}>
          <p className={r.panelTitle}><span>Event log</span><form action={dispatchNowAction}><button className={ui.miniBtn} type="submit">Process now</button></form></p>
          {log.length === 0 ? <p className={r.empty}>No events yet.</p> : (
            <table className={ui.table}><tbody>{log.map(e => <tr key={e.id}><td>{e.at.slice(0, 16).replace("T", " ")}</td><td><b>{e.type}</b><span className={ui.sub} style={{ display: "block" }}>{Object.entries(e.payload).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${String(v)}`).join(" · ").slice(0, 200)}</span></td><td>{e.actor}</td><td>{e.processedAt ? "processed" : "pending"}</td></tr>)}</tbody></table>
          )}
          <p className={ui.sub}>Append-only. Used for triggers, notifications and the Today &quot;what changed&quot; view.</p>
        </section>
      )}
    </>
  );
}

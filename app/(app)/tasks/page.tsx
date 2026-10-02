import Link from "next/link";
import { SquareCheckBig } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { COMMAND_TZ } from "@/lib/command/desk";
import { openTasks } from "@/lib/outreach/queries";
import { completeTaskAction } from "../outreach-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

const TYPE: Record<string, string> = {
  linkedin_connect: "LinkedIn connection", linkedin_message: "LinkedIn message", call: "Call", follow_up: "Follow up", meeting_notes: "Meeting notes", other: "Task",
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/tasks");
  const sp = await searchParams;
  const view = sp.view === "done" ? "done" : "open";
  const rows = await openTasks(user.scope, view);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: COMMAND_TZ }).format(new Date());
  const back = `/tasks${view === "done" ? "?view=done" : ""}`;
  return (
    <>
      <PageHeader title="Tasks" count={view === "open" ? rows.length : undefined} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Task views">
        <Link className={`${ui.tab} ${view === "open" ? ui.tabActive : ""}`} href="/tasks">Open</Link>
        <Link className={`${ui.tab} ${view === "done" ? ui.tabActive : ""}`} href="/tasks?view=done">Done and skipped</Link>
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={SquareCheckBig} title={view === "open" ? "No open tasks" : "Nothing completed yet"} body="LinkedIn steps from sequences land here with the drafted note and a link to the profile. Replies that need a check-back and referrals appear here too." />
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Due</th><th>Task</th><th>Person</th><th>Text to send</th><th>{view === "open" ? "" : "Status"}</th></tr></thead>
            <tbody>
              {rows.map(({ t, contactName, linkedinUrl, orgName }) => {
                const due = t.dueAt.slice(0, 10);
                return (
                  <tr key={t.id} id={`task-${t.id}`} aria-current={sp.focus === t.id ? "true" : undefined} style={sp.focus === t.id ? { background: "color-mix(in srgb, var(--gold) 12%, transparent)" } : undefined}>
                    <td style={{ whiteSpace: "nowrap", color: view === "open" && due < today ? "#b0432f" : undefined }}>{due}</td>
                    <td><span className={ui.primary}>{t.title}</span><span className={ui.sub}>{TYPE[t.type]}</span></td>
                    <td>{t.contactId ? <Link href={`/people/${t.contactId}`}>{contactName}</Link> : "—"}<span className={ui.sub}>{orgName ?? ""}</span>
                      {linkedinUrl && t.type.startsWith("linkedin") && <a className={ui.sub} href={linkedinUrl} target="_blank" rel="noreferrer">Open LinkedIn profile</a>}</td>
                    <td className={ui.wrap} style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{t.body || <span className={ui.chipMuted}>—</span>}</td>
                    <td>
                      {view === "open" ? (
                        <div className={ui.rowActions}>
                          <form action={completeTaskAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} name="outcome" value="done" type="submit">{t.type.startsWith("linkedin") ? "Sent" : "Done"}</button></form>
                          <form action={completeTaskAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} name="outcome" value="skipped" type="submit">Skip</button></form>
                        </div>
                      ) : <span className={ui.chip}>{t.status}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

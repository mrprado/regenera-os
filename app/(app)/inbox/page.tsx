import Link from "next/link";
import { Inbox } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { inboxReplies } from "@/lib/outreach/queries";
import { markReplyHandledAction, sendReplyAction } from "../outreach-actions";
import styles from "./inbox.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

const CLASS_CHIP: Record<string, string> = {
  interested: ui.chipReed, question: ui.chipWater, referral: ui.chipWater, not_now: ui.chipPollen, objection: ui.chipPollen,
  unsubscribe: ui.chipMuted, out_of_office: ui.chipMuted, bounce: ui.chipMuted, hostile: ui.chipEmber, other: "",
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/inbox");
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "open";
  const rows = await inboxReplies(user.scope, view);
  const selected = rows.find(r => r.r.id === sp.id) ?? rows[0];

  return (
    <>
      <PageHeader title="Inbox" count={view === "open" ? rows.length : undefined} />
      <Notice text={sp.notice} />
      <nav className={ui.tabs} aria-label="Inbox views">
        <Link className={`${ui.tab} ${view === "open" ? ui.tabActive : ""}`} href="/inbox">To handle</Link>
        <Link className={`${ui.tab} ${view === "all" ? ui.tabActive : ""}`} href="/inbox?view=all">All replies</Link>
      </nav>
      {!selected ? (
        <EmptyState icon={Inbox} title="No replies to handle" body="Replies to outreach are read from the connected mailboxes every 10 minutes. Claude classifies each one, stops the sequences at that organization and suggests a response for you to edit and send." />
      ) : (
        <div className={styles.shell}><div className={styles.layout}>
          <ol className={styles.list}>
            {rows.map(({ r, contactName, orgName }) => (
              <li key={r.id}>
                <Link className={`${styles.item} ${r.id === selected.r.id ? styles.active : ""}`} href={`/inbox?${view === "all" ? "view=all&" : ""}id=${r.id}`}>
                  <span className={styles.top}><b>{contactName ?? r.fromEmail}</b><span className={`${ui.chip} ${CLASS_CHIP[r.classification ?? "other"] ?? ""}`}>{r.classification?.replace(/_/g, " ") ?? "reading…"}</span></span>
                  <span className={styles.sub}>{orgName ?? r.fromEmail}</span>
                  <span className={styles.sub}>{r.subject}</span>
                </Link>
              </li>
            ))}
          </ol>
          <section className={styles.thread}>
            <header className={styles.head}>
              <div>
                <h2>{selected.contactName ?? selected.r.fromEmail}{selected.contactTitle ? <span>, {selected.contactTitle}</span> : null}</h2>
                <p>{selected.r.fromEmail} · {selected.r.receivedAt.slice(0, 16).replace("T", " ")} UTC{selected.orgName ? ` · ${selected.orgName}` : ""}</p>
              </div>
              <div className={ui.rowActions}>
                {selected.r.contactId && <Link className={ui.miniBtn} style={{ display: "inline-flex", alignItems: "center" }} href={`/people/${selected.r.contactId}`}>Record</Link>}
                {!selected.r.handled && <form action={markReplyHandledAction}><input type="hidden" name="id" value={selected.r.id} /><button className={ui.miniBtn} type="submit">Mark handled</button></form>}
              </div>
            </header>
            {(selected.r.extracted as { summary?: string } | null)?.summary && <p className={ui.read}>{(selected.r.extracted as { summary: string }).summary}</p>}
            <h3 className={styles.subject}>{selected.r.subject}</h3>
            <pre className={styles.body}>{selected.r.body || selected.r.snippet}</pre>
            {selected.r.needsHuman && (
              <form action={sendReplyAction} className={styles.reply}>
                <input type="hidden" name="id" value={selected.r.id} />
                <label htmlFor="reply-body">Your reply {selected.r.suggestedResponse ? "(Claude's suggestion, edit freely)" : ""}</label>
                <textarea id="reply-body" name="body" rows={9} defaultValue={selected.r.suggestedResponse ?? ""} placeholder={selected.r.classification ? "Write your reply" : "Claude is reading this reply. A suggestion appears here shortly."} />
                {(selected.r.extracted as { next_action?: string } | null)?.next_action && <p className={styles.hint}>Suggested next action: {(selected.r.extracted as { next_action: string }).next_action}</p>}
                <div><button className="btn btn--primary" type="submit">Send in thread</button></div>
                <p className={styles.hint}>Sent from the regenera.bio mailbox after the house-style check. Nothing is sent without this click.</p>
              </form>
            )}
          </section>
        </div></div>
      )}
    </>
  );
}

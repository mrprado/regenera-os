import { PortalShell } from "@/components/portal-shell";
import styles from "@/components/portal.module.css";
import { appDb } from "@/lib/db/scoped";
import { clientView } from "@/lib/portal/client";
import { requirePortalUser } from "@/lib/portal/guard";
import { portalMessagesFor } from "@/lib/portal/views";
import { clientChangeAction, clientDeliverableAction, clientRequestResponseAction } from "../actions";
import { MessagesSection } from "../sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client workspace" };

const STATUS = { in_progress: "In progress", review: "Ready for your review", revising: "Being revised", accepted: "Accepted" } as const;
const REQ = { open: "Waiting for you", submitted: "With Regenera", accepted: "Done", rejected: "Needs more", cancelled: "Cancelled" } as const;
const money = (n: number, c: string) => `${c} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Client workspace (phase 29C): progress, what we need, deliverables to review, changes to decide, and invoices. */
export default async function ClientPortal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePortalUser("client");
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const v = await clientView(appDb(), user);
  const es = v.engagements;
  const review = es.flatMap(e => e.deliverables.filter(d => d.status === "review").map(d => ({ e, d })));
  const needed = es.flatMap(e => e.requests.filter(r => r.status === "open" || r.status === "rejected").map(r => ({ e, r })));
  const changes = es.flatMap(e => e.changes.filter(c => c.status === "proposed").map(c => ({ e, c })));

  return (
    <PortalShell kind="client" tab={tab} user={user} notice={sp.notice} brandNote={[...new Set(es.map(e => e.client).filter(Boolean))].join(", ") || null}>
      {tab === "overview" && (
        <>
          <h1>Your work with Regenera</h1>
          <p className={styles.lede}>Where each engagement stands, what we need from you and what is ready for your review.</p>
          {es.length === 0 && <p className={styles.muted}>No engagement has been shared with this account yet.</p>}
          {(review.length > 0 || needed.length > 0 || changes.length > 0) && (
            <section className={styles.section}><h2>Your next steps</h2><ul className={styles.list}>
              {review.map(({ e, d }) => <li key={d.id}><span>Review <b>{d.label}</b> ({e.name})</span><a href="?tab=deliverables">Review</a></li>)}
              {needed.map(({ e, r }) => <li key={r.id}><span>{r.label} ({e.name}){r.dueDate ? ` · due ${r.dueDate}` : ""}</span><a href="?tab=requests">Respond</a></li>)}
              {changes.map(({ e, c }) => <li key={c.id}><span>Decide on the change &quot;{c.title}&quot; ({e.name})</span><a href="#changes">Decide</a></li>)}
            </ul></section>
          )}
          {es.map(e => (
            <section key={e.id} className={styles.section}>
              <h2>{e.name}</h2>
              <p className={styles.muted}>{[e.startDate && `Started ${e.startDate}`, e.endDate && `planned end ${e.endDate}`].filter(Boolean).join(" · ")}</p>
              {e.agreedScope && <div className={styles.card}><p><span className={styles.label}>Agreed scope (version {e.agreedScope.version}{e.agreedScope.acceptedOn ? `, accepted ${e.agreedScope.acceptedOn}` : ""})</span></p><p style={{ whiteSpace: "pre-wrap" }}>{e.agreedScope.scope}</p>{e.agreedScope.responsibilities && <p><span className={styles.label}>Your responsibilities</span>{e.agreedScope.responsibilities}</p>}</div>}
              <ul className={styles.list}>{e.milestones.map(m => {
                const ds = e.deliverables.filter(d => d.milestoneId === m.id);
                return <li key={m.id}><span><b>{m.label}</b>{m.dueDate ? ` · ${m.dueDate}` : ""}<br /><span className={styles.muted}>{ds.map(d => `${d.label}: ${STATUS[d.status]}`).join(" · ")}</span></span><span className={styles.muted}>{m.status === "done" ? "Done" : m.status === "blocked" ? "Blocked" : m.status === "in_progress" ? "In progress" : "Planned"}</span></li>;
              })}</ul>
              {e.deliverables.filter(d => d.waitingOnYou).map(d => <p key={d.id} className={styles.warn}>{d.label} is waiting on you: {d.waitingOnYou}</p>)}
              <div id="changes">{e.changes.filter(c => c.status === "proposed").map(c => (
                <div key={c.id} className={styles.card} style={{ marginTop: 10 }}>
                  <h3>Proposed change: {c.title}</h3><p>{c.scopeEffect}</p><p className={styles.muted}>Fee {c.feeImpact >= 0 ? "+" : ""}{money(c.feeImpact, c.currency)} · timeline {c.timelineWeeks >= 0 ? "+" : ""}{c.timelineWeeks} weeks</p>
                  <form action={clientChangeAction} style={{ display: "inline" }}><input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="decision" value="approved" /><button className="btn btn--primary" type="submit">Approve change</button></form>{" "}
                  <form action={clientChangeAction} style={{ display: "inline" }}><input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="decision" value="rejected" /><button className="btn" type="submit">Decline</button></form>
                </div>))}</div>
            </section>
          ))}
        </>
      )}

      {tab === "deliverables" && (
        <>
          <h1>Deliverables</h1>
          <p className={styles.lede}>Accept a deliverable when it meets the agreed scope, or tell us what should change.</p>
          {es.flatMap(e => e.deliverables.map(d => (
            <div key={d.id} className={styles.card} style={{ marginBottom: 12 }}>
              <h3>{d.label}</h3>
              <p className={styles.muted}>{e.name} · {STATUS[d.status]}{d.version > 1 ? ` · version ${d.version}` : ""}{d.dueDate ? ` · due ${d.dueDate}` : ""}{d.acceptedAt ? ` · accepted ${d.acceptedAt}` : ""}</p>
              {d.artifactUrl && <p><a href={d.artifactUrl} target="_blank" rel="noreferrer">Open the deliverable</a></p>}
              {d.status === "review" && <>
                <form action={clientDeliverableAction} className={styles.form}><input type="hidden" name="deliverableId" value={d.id} /><input type="hidden" name="decision" value="accept" /><label>Comment (optional)<input name="note" /></label><button className="btn btn--primary" type="submit">Accept</button></form>
                <form action={clientDeliverableAction} className={styles.form}><input type="hidden" name="deliverableId" value={d.id} /><input type="hidden" name="decision" value="revise" /><label>What should change?<textarea name="note" rows={3} required /></label><button className="btn" type="submit">Request a revision</button></form>
              </>}
            </div>
          )))}
          {es.every(e => !e.deliverables.length) && <p className={styles.muted}>No deliverables yet.</p>}
        </>
      )}

      {tab === "requests" && (
        <>
          <h1>What we need from you</h1>
          {es.flatMap(e => e.requests.map(r => (
            <div key={r.id} className={styles.card} style={{ marginBottom: 12 }}>
              <h3>{r.label}</h3>
              <p className={styles.muted}>{e.name} · {REQ[r.status as keyof typeof REQ] ?? r.status}{r.dueDate ? ` · due ${r.dueDate}` : ""}</p>
              {r.description && <p>{r.description}</p>}
              {r.reviewNote && <p className={styles.warn}>Still needed: {r.reviewNote}</p>}
              {r.response && <p><span className={styles.label}>Your response</span>{r.response}</p>}
              {(r.status === "open" || r.status === "rejected") && <form action={clientRequestResponseAction} className={styles.form}><input type="hidden" name="requestId" value={r.id} /><label>Response, or a link to the document (please do not paste passwords)<textarea name="response" rows={3} required /></label><button className="btn btn--primary" type="submit">Send to Regenera</button></form>}
            </div>
          )))}
          {needed.length === 0 && es.every(e => !e.requests.length) && <p className={styles.muted}>Nothing requested.</p>}
        </>
      )}

      {tab === "invoices" && (
        <>
          <h1>Invoices</h1>
          {es.every(e => !e.invoices.length) ? <p className={styles.muted}>No invoices issued.</p> : (
            <ul className={styles.list}>{es.flatMap(e => e.invoices.map(i => <li key={i.id}><span><b>{i.number}</b> · {e.name}<br /><span className={styles.muted}>{i.issueDate ? `Issued ${i.issueDate}` : ""}{i.dueDate ? ` · due ${i.dueDate}` : ""}</span></span><span>{money(i.amount, i.currency)}<br /><span className={styles.muted}>{i.status === "paid" ? "Paid" : i.paidAmount > 0 ? `${money(i.paidAmount, i.currency)} received` : "Open"}</span></span></li>))}</ul>
          )}
          <p className={styles.muted}>Payments are recorded by Regenera when received. Questions about an invoice: use Messages.</p>
        </>
      )}

      {tab === "messages" && <><h1>Messages</h1><MessagesSection messages={await portalMessagesFor(appDb(), user)} /></>}
    </PortalShell>
  );
}

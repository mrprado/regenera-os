import styles from "@/components/portal.module.css";
import { withBase } from "@/lib/base-path";
import { REQUEST_STATUSES } from "@/lib/portal/vocab";
import type { portalDocuments, portalMessagesFor, portalRequests } from "@/lib/portal/views";
import { acceptNdaAction, respondRequestAction, sendPortalMessageAction } from "./actions";

type Docs = Awaited<ReturnType<typeof portalDocuments>>;

export function DocumentsSection({ docs }: { docs: Docs }) {
  const empty = docs.rooms.length === 0 && docs.direct.length === 0;
  return (
    <>
      <p className={styles.lede}>Documents Regenera has shared with you. Each opening is checked and logged; if something is not available, the reason is shown.</p>
      {empty && <p className={styles.muted}>Nothing has been shared yet.</p>}
      {docs.rooms.map(r => (
        <section key={r.id} className={styles.section}>
          <h2>Data room · {r.name}</h2>
          {!r.ndaAccepted ? (
            <div className={styles.card}>
              <p style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{r.ndaText}</p>
              <form action={acceptNdaAction} className={styles.form}>
                <input type="hidden" name="dataRoomId" value={r.id} />
                <label>Your full name<input name="name" required minLength={2} autoComplete="name" /></label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="agree" required /> I accept this confidentiality undertaking (version {r.ndaVersion})</label>
                <button className="btn btn--primary" type="submit">Accept and open</button>
              </form>
            </div>
          ) : r.folders.length === 0 ? <p className={styles.muted}>No documents in this room yet.</p> : r.folders.map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <p className={styles.label}>{f.label}</p>
              <ul className={styles.list}>{f.docs.map(d => <li key={d.id}><a href={withBase(`/api/portal/doc/${d.id}`)} target="_blank" rel="noreferrer">{d.title}</a><span className={styles.muted}>v{d.version} · {d.updatedAt.slice(0, 10)}</span></li>)}</ul>
            </div>
          ))}
        </section>
      ))}
      {docs.direct.length > 0 && (
        <section className={styles.section}>
          <h2>Shared with you</h2>
          <ul className={styles.list}>{docs.direct.map(d => <li key={d.id}><a href={withBase(`/api/portal/doc/${d.id}`)} target="_blank" rel="noreferrer">{d.title}</a><span className={styles.muted}>v{d.version} · {d.updatedAt.slice(0, 10)}</span></li>)}</ul>
        </section>
      )}
    </>
  );
}

export function MessagesSection({ messages }: { messages: Awaited<ReturnType<typeof portalMessagesFor>> }) {
  return (
    <>
      <form action={sendPortalMessageAction} className={styles.form}>
        <label>Message to Regenera<textarea name="body" rows={4} required maxLength={4000} /></label>
        <button className="btn btn--primary" type="submit">Send</button>
      </form>
      <section className={styles.section}>
        <h2>Conversation</h2>
        {messages.length === 0 ? <p className={styles.muted}>No messages yet.</p> : (
          <ul className={styles.list}>{messages.map(m => <li key={m.id}><span style={{ whiteSpace: "pre-wrap" }}><b>{m.direction === "in" ? "You" : "Regenera"}</b> · {m.body}</span><span className={styles.muted}>{m.createdAt.slice(0, 16).replace("T", " ")}</span></li>)}</ul>
        )}
      </section>
    </>
  );
}

export function RequestsSection({ requests }: { requests: Awaited<ReturnType<typeof portalRequests>> }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <p className={styles.lede}>What Regenera needs from you. Share a secure link (Drive, Dropbox, your data room); a note is fine where a document does not exist yet.</p>
      {requests.length === 0 ? <p className={styles.muted}>No open requests.</p> : (
        <ul className={styles.list}>{requests.map(r => (
          <li key={r.id} style={{ display: "block" }}>
            <b>{r.title}</b> <span className={styles.label}>{REQUEST_STATUSES[r.status]}</span>{r.dueDate && <span className={r.dueDate < today && r.status === "open" ? styles.warn : styles.muted}> due {r.dueDate}</span>}
            {r.description && <p className={styles.muted} style={{ margin: "4px 0" }}>{r.description}</p>}
            {(r.status === "open" || r.status === "rejected") && (
              <form action={respondRequestAction} className={styles.form} style={{ marginTop: 8 }}>
                <input type="hidden" name="requestId" value={r.id} />
                <label>Link<input name="responseUrl" type="url" placeholder="https://" /></label>
                <label>Note<textarea name="responseNote" rows={2} defaultValue={r.responseNote} /></label>
                <button className="btn" type="submit">Submit</button>
              </form>
            )}
          </li>
        ))}</ul>
      )}
    </>
  );
}

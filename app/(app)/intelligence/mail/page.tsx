import Link from "next/link";
import { Mail } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner } from "@/lib/db/scoped";
import { withBase } from "@/lib/base-path";
import { MAIL_CLASSES } from "@/lib/mail-intel/classify";
import { mailLedgers, mailOverview, mailPeopleList, mailThreadList } from "@/lib/mail-intel/queries";
import { obligationDoneAction, obligationDropAction, reviewAcceptAction, reviewRejectAction } from "../../mail-actions";
import f from "../../funding/funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email intelligence" };

const TABS = [["overview", "Overview"], ["threads", "Threads"], ["people", "People"], ["obligations", "Commitments & requests"], ["introductions", "Introductions"], ["documents", "Documents"], ["facts", "Facts"], ["campaigns", "Campaigns"], ["review", "Review queue"]] as const;
const day = (s?: string | null) => (s ? s.slice(0, 10) : "—");
const label = (s: string) => s.replace(/_/g, " ");

export default async function MailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/intelligence/mail");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  if (!isOwner(user.scope)) return (<><PageHeader title="Email intelligence" /><EmptyState icon={Mail} title="Owner only" body="Email intelligence is the workspace owner's correspondence and is visible to owners only." /></>);
  const db = appDb();
  const ov = await mailOverview(db, user.scope);
  if (!ov || !ov.sources.length) return (<><PageHeader title="Email intelligence" /><EmptyState icon={Mail} title="No mailbox imported" body="Run the read-only backfill (node scripts/mail-import.mjs <dir>) to build the archive. Gmail is never modified." /></>);

  return (
    <>
      <PageHeader title="Email intelligence" count={ov.counts?.substantive ?? 0} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Read-only archive of {ov.sources.map(s => s.account).join(", ")} ({ov.sources[0].boundaryStart} to {ov.sources[0].boundaryEnd}). Three truth layers: source messages are immutable, extracted facts cite their message, and CRM records change only through conservative promotion or review. Spam and Trash are excluded; bulk system and marketing senders are classified as low signal. Never reaches Ask the OS, MCP or global search.</p>
      <nav className={ui.tabs} aria-label="Email views">
        {TABS.map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={k === "overview" ? "/intelligence/mail" : `/intelligence/mail?tab=${k}`}>{v}</Link>)}
      </nav>
      {tab === "overview" && <Overview ov={ov} />}
      {tab === "threads" && <Threads sp={sp} scope={user.scope} />}
      {tab === "people" && <People scope={user.scope} all={sp.all === "1"} />}
      {tab !== "overview" && tab !== "threads" && tab !== "people" && <Ledgers tab={tab} scope={user.scope} />}
    </>
  );
}

type Ov = NonNullable<Awaited<ReturnType<typeof mailOverview>>>;
type Scope = Parameters<typeof mailThreadList>[1];

function Overview({ ov }: { ov: Ov }) {
  const c = ov.counts!;
  const stats: [string, number, string][] = [["Substantive threads", c.substantive, "/intelligence/mail?tab=threads"], ["All threads", c.threads, "/intelligence/mail?tab=threads&all=1"], ["Messages archived", c.messages, ""], ["People (non-bulk)", c.people, "/intelligence/mail?tab=people"], ["Replies owed by me", c.awaitingMe, "/intelligence/mail?tab=threads&awaiting=me"], ["Open commitments & requests", c.openObligations, "/intelligence/mail?tab=obligations"], ["Open review items", c.openReviews, "/intelligence/mail?tab=review"]];
  return (
    <>
      <dl className={f.strip}>{stats.map(([k, v, h]) => <div key={k}><dt>{k}</dt><dd>{h ? <Link href={h}>{v}</Link> : v}</dd></div>)}</dl>
      <h3 className={f.kicker}>Sync status</h3>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Account</th><th>Transport</th><th>Window</th><th>Mode</th><th>Spam / Trash</th></tr></thead>
        <tbody>{ov.sources.map(s => <tr key={s.account}><td>{s.account}<span className={ui.sub}>{s.ownAddresses.join(", ")}</span></td><td>{label(s.transport)}</td><td>{s.boundaryStart} → {s.boundaryEnd}</td><td>{s.syncMode}</td><td>{s.includeSpamTrash ? "Included" : "Excluded"}</td></tr>)}</tbody>
      </table></div>
      <h3 className={f.kicker}>Ingestion runs</h3>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Started</th><th>Status</th><th>Counts</th><th>Versions</th><th>By</th></tr></thead>
        <tbody>{ov.runs.map(r => <tr key={r.id}><td>{r.startedAt.slice(0, 16).replace("T", " ")}</td><td><span className={f.state} data-s={r.status === "complete" ? "confirmed" : r.status === "failed" ? "blocked" : "uncertain"}>{r.status}</span></td><td className={ui.wrap}>{Object.entries(r.counts).map(([k, v]) => `${label(k)} ${v}`).join(" · ")}</td><td className={ui.sub}>{r.ingestionVersion} · schema {r.schemaVersion} · {r.extractionModel}</td><td>{r.startedBy}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}

async function Threads({ sp, scope }: { sp: Record<string, string | undefined>; scope: Scope }) {
  const rows = await mailThreadList(appDb(), scope, { q: sp.q, cls: sp.cls, awaiting: sp.awaiting, all: sp.all === "1" });
  return (
    <>
      <form action={withBase("/intelligence/mail")} className={f.inline} style={{ marginBottom: 12 }}>
        <input type="hidden" name="tab" value="threads" />
        <input name="q" defaultValue={sp.q} placeholder="Subject, summary or participant" aria-label="Search threads" style={{ minWidth: 260 }} />
        <select name="cls" defaultValue={sp.cls ?? ""} aria-label="Class"><option value="">All classes</option>{Object.entries(MAIL_CLASSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="awaiting" defaultValue={sp.awaiting ?? ""} aria-label="Awaiting"><option value="">Any reply state</option><option value="me">Reply owed by me</option><option value="them">Awaiting them</option><option value="unanswered">Unanswered inbound</option></select>
        <label className={ui.sub}><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> include low-signal</label>
        <button className="btn" type="submit">Filter</button>
      </form>
      {rows.length === 0 ? <EmptyState icon={Mail} title="No threads" body="Nothing matches these filters." /> : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Thread</th><th>Class</th><th>State</th><th>Messages</th><th>Last</th><th>Reply</th><th>Linked</th></tr></thead>
          <tbody>{rows.map(t => (
            <tr key={t.key}>
              <td className={ui.wrap}><span className={ui.primary}>{t.subject || "(no subject)"}</span><span className={ui.sub}>{t.summary || t.participants.slice(0, 4).join(", ")}</span></td>
              <td>{MAIL_CLASSES[t.mailClass as keyof typeof MAIL_CLASSES] ?? label(t.mailClass)}</td>
              <td>{label(t.state)}</td>
              <td>{t.messageCount}<span className={ui.sub}>{t.sentCount} sent · {t.receivedCount} received</span></td>
              <td>{day(t.lastAt)}</td>
              <td>{t.awaitingReplyFrom === "me" ? <span className={f.state} data-s="blocked">Owed by me</span> : t.awaitingReplyFrom === "them" ? "Awaiting them" : t.awaitingReplyFrom === "unanswered" ? "Unanswered inbound" : "—"}</td>
              <td className={ui.sub}>{[t.contactIds.length && `${t.contactIds.length} people`, t.orgIds.length && `${t.orgIds.length} orgs`, t.projectIds.length && `${t.projectIds.length} projects`, t.dealIds.length && `${t.dealIds.length} deals`].filter(Boolean).join(" · ") || "—"}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}

async function People({ scope, all }: { scope: Scope; all: boolean }) {
  const rows = await mailPeopleList(appDb(), scope, all);
  return (
    <>
      <p className={ui.sub}>Relationship strength (how much real two-way exchange) is shown separately from commercial stage (how far a matter has progressed). Evidence lists the messages behind each reading. <Link href={all ? "/intelligence/mail?tab=people" : "/intelligence/mail?tab=people&all=1"}>{all ? "Hide bulk senders" : "Show bulk senders"}</Link></p>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Person</th><th>Strength</th><th>Relationship</th><th>Engagement</th><th>Commercial</th><th>Exchange</th><th>Last</th><th>CRM</th></tr></thead>
        <tbody>{rows.map(p => (
          <tr key={p.id}>
            <td className={ui.wrap}><span className={ui.primary}>{p.name || p.email}</span><span className={ui.sub}>{p.email}{p.origin ? ` · ${label(p.origin)}` : ""}</span></td>
            <td><span className={f.state} data-s={p.strength === "strong" ? "confirmed" : p.strength === "moderate" ? "likely" : "uncertain"}>{p.strength}</span></td>
            <td>{p.relationshipStage}</td>
            <td>{label(p.engagementState)}</td>
            <td>{label(p.commercialStage)}</td>
            <td className={ui.sub}>{p.sentCount} sent · {p.receivedCount} received · {p.replyCount} replies{p.meetingCount ? ` · ${p.meetingCount} meetings` : ""}</td>
            <td>{day(p.lastAt)}</td>
            <td>{p.contactId ? <Link href={`/people/${p.contactId}`}>Contact</Link> : "—"}{p.orgId && <span className={ui.sub}><Link href={`/companies/${p.orgId}`}>Organization</Link></span>}</td>
          </tr>))}</tbody>
      </table></div>
    </>
  );
}

async function Ledgers({ tab, scope }: { tab: string; scope: Scope }) {
  const l = await mailLedgers(appDb(), scope);
  if (tab === "obligations") return l.obligations.length === 0 ? <EmptyState icon={Mail} title="No commitments or requests" body="Extractions record who promised or asked what, with the message as evidence." /> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>What</th><th>Kind</th><th>Who → whom</th><th>Due</th><th>Status</th><th>Confidence</th><th /></tr></thead>
      <tbody>{l.obligations.map(o => (
        <tr key={o.id}>
          <td className={ui.wrap}>{o.text}</td>
          <td>{o.kind === "commitment" ? (o.byMe ? "I committed" : "They committed") : (o.byMe ? "I asked" : "Asked of me")}{!o.firm && <span className={ui.sub}>soft</span>}</td>
          <td>{o.actor} → {o.counterparty}</td>
          <td>{day(o.dueDate)}</td>
          <td><span className={f.state} data-s={o.status === "open" ? "uncertain" : "confirmed"}>{o.status}</span></td>
          <td>{Math.round(o.confidence * 100)}%</td>
          <td>{o.status === "open" && <span className={f.inline}><form action={obligationDoneAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">Done</button></form><form action={obligationDropAction}><input type="hidden" name="id" value={o.id} /><button className="btn" type="submit">Drop</button></form></span>}</td>
        </tr>))}</tbody>
    </table></div>
  );
  if (tab === "introductions") return l.introductions.length === 0 ? <EmptyState icon={Mail} title="No introductions" body="Warm introductions found in correspondence appear here with their source." /> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Date</th><th>Introducer</th><th>Introduced</th><th>Context</th><th>Result</th></tr></thead>
      <tbody>{l.introductions.map(i => <tr key={i.id}><td>{day(i.date)}</td><td>{i.introducerEmail}</td><td>{i.introducedEmail ?? "—"}{i.introducedOrg && <span className={ui.sub}>{i.introducedOrg}</span>}</td><td className={ui.wrap}>{i.context}</td><td>{label(i.resultingState)}</td></tr>)}</tbody>
    </table></div>
  );
  if (tab === "documents") return l.attachments.length === 0 ? <EmptyState icon={Mail} title="No documents" body="Attachment metadata only; files are not copied from Gmail." /> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>File</th><th>Type</th><th>Confidentiality</th><th>NDA</th><th>Received</th></tr></thead>
      <tbody>{l.attachments.map(a => <tr key={a.id}><td className={ui.wrap}>{a.filename}</td><td>{label(a.documentType)}</td><td>{a.confidentiality}</td><td>{a.ndaCovered}</td><td>{day(a.createdAt)}</td></tr>)}</tbody>
    </table></div>
  );
  if (tab === "facts") return l.facts.length === 0 ? <EmptyState icon={Mail} title="No facts" body="Extracted facts cite a source message; explicit, derived and hypothesis are kept apart." /> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Entity</th><th>Field</th><th>Value</th><th>Type</th><th>Effective</th><th>Confidence</th><th>Source</th></tr></thead>
      <tbody>{l.facts.map(x => <tr key={x.id}><td>{x.entityLabel}<span className={ui.sub}>{x.entityType}</span></td><td>{label(x.field)}</td><td className={ui.wrap}>{x.value}</td><td><span className={f.state} data-s={x.factType === "explicit" ? "confirmed" : x.factType === "derived" ? "likely" : "uncertain"}>{x.factType === "explicit" ? "Source fact" : x.factType === "derived" ? "Derived" : "Model inference"}</span></td><td>{day(x.effectiveDate)}</td><td>{Math.round(x.confidence * 100)}%</td><td className={ui.sub}>{x.model}</td></tr>)}</tbody>
    </table></div>
  );
  if (tab === "campaigns") return l.campaigns.length === 0 ? <EmptyState icon={Mail} title="No campaigns detected" body="A campaign is three or more recipients of the same templated message. None were found in this window." /> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Campaign</th><th>Period</th><th>Counts</th></tr></thead>
      <tbody>{l.campaigns.map(c => <tr key={c.id}><td>{c.name}<span className={ui.sub}>{c.subjectTemplate}</span></td><td>{day(c.startedAt)} → {day(c.endedAt)}</td><td className={ui.sub}>{Object.entries(c.counts).map(([k, v]) => `${label(k)} ${v}`).join(" · ")}</td></tr>)}</tbody>
    </table></div>
  );
  return l.reviews.length === 0 ? <EmptyState icon={Mail} title="Review queue is clear" body="Merges, financial changes, NDA status and compliance questions wait here for a human decision." /> : (
    <div className={ui.tableWrap}><table className={ui.table}>
      <thead><tr><th>Item</th><th>Kind</th><th>Status</th><th>Raised</th><th /></tr></thead>
      <tbody>{l.reviews.map(r => (
        <tr key={r.id}>
          <td className={ui.wrap}>{r.title}</td><td>{label(r.kind)}</td>
          <td><span className={f.state} data-s={r.status === "open" ? "uncertain" : r.status === "accepted" ? "confirmed" : "blocked"}>{r.status}</span>{r.resolvedBy && <span className={ui.sub}>{r.resolvedBy}</span>}</td>
          <td>{day(r.createdAt)}</td>
          <td>{r.status === "open" && <span className={f.inline}><form action={reviewAcceptAction}><input type="hidden" name="id" value={r.id} /><button className="btn" type="submit">Accept</button></form><form action={reviewRejectAction}><input type="hidden" name="id" value={r.id} /><button className="btn" type="submit">Reject</button></form></span>}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

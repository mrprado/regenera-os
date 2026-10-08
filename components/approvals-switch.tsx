// Phase 24: one Approvals inbox. Four sources stay on their own pages; this bar shows them together with live counts so
// nothing waiting for a person is missed.
import Link from "next/link";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { approvals, contacts, introductions, messages, tasks } from "@/db/schema";
import { appDb, mandateCondition, type Scope } from "@/lib/db/scoped";
import ui from "./ui.module.css";

export async function approvalCounts(scope: Scope) {
  const db = appDb();
  const c = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [decisions, outreach, proposals, intros] = await Promise.all([
    c(db.select({ n: sql<number>`count(*)` }).from(approvals).where(and(mandateCondition(scope, approvals.mandateId), eq(approvals.status, "pending")))),
    c(db.select({ n: sql<number>`count(*)` }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId)).where(and(mandateCondition(scope, messages.mandateId), inArray(messages.status, ["pending_approval", "style_failed"]), eq(contacts.testRecord, false)))),
    c(db.select({ n: sql<number>`count(*)` }).from(tasks).where(and(mandateCondition(scope, tasks.mandateId), eq(tasks.status, "open"), eq(tasks.testRecord, false), like(tasks.title, "Approve %")))),
    c(db.select({ n: sql<number>`count(*)` }).from(introductions).where(and(mandateCondition(scope, introductions.mandateId), eq(introductions.status, "requested")))),
  ]);
  return { decisions, outreach, proposals, intros, total: decisions + outreach + proposals + intros };
}

export default async function ApprovalsSwitch({ scope, current }: { scope: Scope; current: "decisions" | "outreach" | "proposals" | "intros" }) {
  const n = await approvalCounts(scope);
  const tabs = [
    { key: "decisions", label: "Bids, NDAs & gates", href: "/approvals", count: n.decisions },
    { key: "outreach", label: "Outreach drafts", href: "/queue", count: n.outreach },
    { key: "proposals", label: "Proposals", href: "/tasks?view=approvals", count: n.proposals },
    { key: "intros", label: "Capital introductions", href: "/capital?tab=introductions", count: n.intros },
  ];
  return (
    <nav className={ui.tabs} aria-label={`Approvals: ${n.total} waiting`}>
      {tabs.map(t => <Link key={t.key} className={`${ui.tab} ${t.key === current ? ui.tabActive : ""}`} href={t.href} aria-current={t.key === current ? "page" : undefined}>{t.label} · {t.count}</Link>)}
    </nav>
  );
}

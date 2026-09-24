import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { aiConfig } from "@/lib/config";
import { queueItems } from "@/lib/outreach/queries";
import { undoAction } from "../outreach-actions";
import QueueClient from "./queue-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval queue" };

type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireOsUser("/queue");
  const sp = await searchParams;
  const tier = sp.tier === "mass" || sp.tier === "targeted" ? sp.tier : undefined;
  const all = await queueItems(user.scope);
  const items = tier ? all.filter(i => i.tier === tier) : all;
  const counts = { all: all.length, mass: all.filter(i => i.tier === "mass").length, targeted: all.filter(i => i.tier === "targeted").length };
  const back = `/queue${tier ? `?tier=${tier}` : ""}`;

  return (
    <>
      <PageHeader title="Approval queue" count={all.length} />
      {sp.undo && (
        <form action={undoAction} className={ui.notice} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <span>Approved. It will not send for at least 60 seconds.</span>
          <input type="hidden" name="id" value={sp.undo} /><input type="hidden" name="back" value={back} />
          <button className={ui.miniBtn} type="submit">Undo</button>
        </form>
      )}
      <Notice text={sp.notice} />
      {!aiConfig() && <p className={ui.notice}>Drafting needs <code>ANTHROPIC_API_KEY</code> (docs/ENV.md). Enrolled people wait here until it is set.</p>}
      <nav className={ui.tabs} aria-label="Tier">
        <Link className={`${ui.tab} ${!tier ? ui.tabActive : ""}`} href="/queue">All<span className={ui.tabCount}>{counts.all}</span></Link>
        <Link className={`${ui.tab} ${tier === "targeted" ? ui.tabActive : ""}`} href="/queue?tier=targeted">Targeted<span className={ui.tabCount}>{counts.targeted}</span></Link>
        <Link className={`${ui.tab} ${tier === "mass" ? ui.tabActive : ""}`} href="/queue?tier=mass">Mass<span className={ui.tabCount}>{counts.mass}</span></Link>
      </nav>
      {items.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nothing to review" body="Enroll people in a sequence from People or a List. Claude drafts every step from the dossier and the current trigger, checks house style, and each draft waits here for you." actions={<Link className="btn" href="/people">Go to People</Link>} />
      ) : (
        <QueueClient items={items} back={back} focusId={sp.focus} />
      )}
    </>
  );
}

import Link from "next/link";
import { Target } from "lucide-react";
import { Notice } from "@/components/crm-bits";
import { EmptyState, PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { withBase } from "@/lib/base-path";
import { day, label, money, staleCutoff } from "@/lib/mandates/format";
import { pursuitsFor } from "@/lib/mandates/queries";
import { ATTRIBUTION, flowFor, PURSUIT_OUTCOMES, PURSUIT_TYPES, type PursuitType } from "@/lib/mandates/vocab";
import f from "../funding/funding.module.css";
import s from "../mandates/mandates.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pursuits" };

export default async function PursuitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/pursuits");
  const sp = await searchParams;
  const outcome = sp.outcome ?? "open";
  const rows = await pursuitsFor(appDb(), user.scope, { outcome: outcome === "all" ? undefined : outcome, type: sp.type });
  const pipeline = rows.reduce((a, r) => a + (r.p.value ?? 0), 0), weighted = rows.reduce((a, r) => a + (r.p.value ?? 0) * r.prob.effective / 100, 0);
  const cutoff = staleCutoff();
  const stale = rows.filter(r => (r.p.lastActionAt ?? r.p.createdAt) < cutoff && r.p.outcome === "open");
  const view = sp.view === "board" ? "board" : "table";
  const boardType = (sp.type as PursuitType) ?? "epc";
  return (
    <>
      <PageHeader title="Pursuits" count={rows.length} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Active commercial efforts before (and through) a transaction: EPC, investment, capital raise, offtake, land, funding, partnership. Each opens from a client-approved candidate, keeps its attribution, and changes stage only with a reason. Probability is a stage default unless a person overrides it with a reason.</p>
      <dl className={f.strip}>
        <div><dt>Pursuits</dt><dd>{rows.length}</dd></div>
        <div><dt>Pipeline value</dt><dd>{money(pipeline)}</dd></div>
        <div><dt>Weighted</dt><dd>{money(weighted)}</dd></div>
        <div><dt>Stalled (14 days)</dt><dd className={stale.length ? f.warn : ""}>{stale.length}</dd></div>
      </dl>
      <form action={withBase("/pursuits")} className={f.inline} style={{ marginBottom: 10 }}>
        <select name="outcome" defaultValue={outcome} aria-label="Outcome"><option value="all">All outcomes</option>{Object.entries(PURSUIT_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Type"><option value="">All types</option>{Object.entries(PURSUIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="view" defaultValue={view} aria-label="View"><option value="table">Table</option><option value="board">Board (one type)</option></select>
        <button className="btn" type="submit">Show</button>
      </form>
      {rows.length === 0 ? <EmptyState icon={Target} title="No pursuits" body="Approve a qualified candidate on a mandate, then open its pursuit." actions={<Link className="btn" href="/mandates">Mandates</Link>} /> : view === "board" ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${flowFor(boardType).length}, minmax(150px, 1fr))`, overflowX: "auto", borderTop: "1px solid var(--line)" }}>
          {flowFor(boardType).map(st => (
            <div key={st.key} style={{ borderRight: "1px solid var(--line)", padding: "8px" }}>
              <h3 className={f.kicker}>{st.label} · {st.p}%</h3>
              {rows.filter(r => r.p.type === boardType && r.p.stage === st.key).map(r => <p key={r.p.id} style={{ fontSize: 12.5, margin: "0 0 8px" }}><Link href={`/pursuits/${r.p.id}`}>{r.p.name}</Link><span className={ui.sub}>{money(r.p.value)} · {r.p.owner ?? "—"}</span></p>)}
            </div>
          ))}
        </div>
      ) : (
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Pursuit</th><th>Mandate</th><th>Stage</th><th className={ui.num}>Value</th><th className={ui.num}>Probability</th><th>Owner</th><th>Next action</th><th>Last action</th><th>Attribution</th></tr></thead>
          <tbody>{rows.map(({ p, mandate, client, prob }) => (
            <tr key={p.id}>
              <td className={ui.wrap}><span className={ui.primary}><Link href={`/pursuits/${p.id}`}>{p.name}</Link></span><span className={ui.sub}>{PURSUIT_TYPES[p.type as PursuitType]}{p.outcome !== "open" ? ` · ${PURSUIT_OUTCOMES[p.outcome as keyof typeof PURSUIT_OUTCOMES]}` : ""}</span></td>
              <td>{p.commercialMandateId ? <Link href={`/mandates/${p.commercialMandateId}`}>{mandate}</Link> : "—"}<span className={ui.sub}>{client}</span></td>
              <td>{label(p.stage)}{p.bidDecision && <span className={ui.sub}>bid: {label(p.bidDecision)}</span>}</td>
              <td className={ui.num}>{money(p.value)}</td>
              <td className={ui.num}>{prob.effective}%<span className={ui.sub}>{prob.overridden ? "override" : "default"}</span></td>
              <td>{p.owner ?? "—"}</td>
              <td className={ui.wrap}>{p.nextAction || "—"}{p.nextActionDate ? <span className={ui.sub}>{day(p.nextActionDate)}</span> : null}</td>
              <td><span className={s.reading} data-r={(p.lastActionAt ?? p.createdAt) < cutoff && p.outcome === "open" ? "at_risk" : undefined}>{day(p.lastActionAt ?? p.createdAt)}</span></td>
              <td>{ATTRIBUTION[p.attribution as keyof typeof ATTRIBUTION]?.label}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}

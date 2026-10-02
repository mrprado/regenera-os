import Link from "next/link";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal } from "@/lib/db/scoped";
import { deskSummary, mandateEconomics } from "@/lib/mandates/engine";
import { money, pct } from "@/lib/mandates/format";
import { mandatesFor } from "@/lib/mandates/queries";
import { DESKS, MANDATE_STATUSES, SEATS, STAFFING, type MandateType, type Seat } from "@/lib/mandates/vocab";
import f from "../../funding/funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Desks & economics" };

export default async function DesksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/mandates");
  const sp = await searchParams;
  if (!isInternal(user.scope)) return <><PageHeader title="Desks & economics" /><p className={ui.notice}>Regenera internal only.</p></>;
  const db = appDb();
  const desks = await deskSummary(db, user.scope.mandateIds);
  const rows = await mandatesFor(db, user.scope);
  const econ = await Promise.all(rows.map(async r => ({ m: r.m, e: await mandateEconomics(db, r.m) })));
  const live = econ.filter(x => ["active", "pilot"].includes(x.m.status));
  const seatHours = new Map<Seat, number>();
  for (const x of live) for (const s of x.e.seats) seatHours.set(s.seat, (seatHours.get(s.seat) ?? 0) + s.hours);
  const mrr = live.reduce((a, x) => a + x.m.retainer, 0), cost = live.reduce((a, x) => a + x.e.monthlyCost, 0);
  return (
    <>
      <PageHeader title="Desks & economics" />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Desk P&L from mandate records: retainers, delivery cost from the staffing plan (team rates where assigned, planning rate otherwise), pursuit pipeline weighted by stage probability. Success fees are shown as potential only. Capacity follows revenue: a seat above ~140 hours a month across live mandates signals the next hire.</p>
      <dl className={f.strip}>
        <div><dt>MRR (live)</dt><dd>{money(mrr)}</dd></div><div><dt>ARR run-rate</dt><dd>{money(mrr * 12)}</dd></div>
        <div><dt>Delivery cost / month</dt><dd>{money(cost)}</dd></div><div><dt>Contribution / month</dt><dd>{money(mrr - cost)}</dd></div><div><dt>Margin</dt><dd>{pct(mrr ? (mrr - cost) / mrr : null)}</dd></div>
      </dl>
      <h3 className={f.kicker}>Desks</h3>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Desk</th><th className={ui.num}>Mandates</th><th className={ui.num}>Active</th><th className={ui.num}>MRR</th><th className={ui.num}>ARR</th><th className={ui.num}>Margin</th><th className={ui.num}>Pursuits</th><th className={ui.num}>Pipeline</th><th className={ui.num}>Weighted</th><th className={ui.num}>Won</th></tr></thead>
        <tbody>{desks.map(d => <tr key={d.desk}><td>{DESKS[d.desk as keyof typeof DESKS] ?? d.desk}</td><td className={ui.num}>{d.mandates}</td><td className={ui.num}>{d.active}</td><td className={ui.num}>{money(d.mrr)}</td><td className={ui.num}>{money(d.arr)}</td><td className={ui.num}>{pct(d.margin)}</td><td className={ui.num}>{d.pursuits}</td><td className={ui.num}>{money(d.pipeline)}</td><td className={ui.num}>{money(d.weighted)}</td><td className={ui.num}>{d.won}</td></tr>)}</tbody>
      </table></div>
      <h3 className={f.kicker} style={{ marginTop: 16 }}>Mandate economics</h3>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Mandate</th><th>Status</th><th className={ui.num}>Revenue (term)</th><th className={ui.num}>Cost (term)</th><th className={ui.num}>Gross profit</th><th className={ui.num}>Margin</th><th>Success component</th></tr></thead>
        <tbody>{econ.map(({ m, e }) => <tr key={m.id}><td><Link href={`/mandates/${m.id}?tab=economics`}>{m.name}</Link></td><td>{MANDATE_STATUSES[m.status as keyof typeof MANDATE_STATUSES]}</td><td className={ui.num}>{money(e.totalRevenue)}</td><td className={ui.num}>{money(e.totalCost)}</td><td className={ui.num}>{money(e.grossProfit)}</td><td className={ui.num}>{pct(e.margin)}</td><td className={ui.wrap}>{e.successNote}</td></tr>)}</tbody>
      </table></div>
      <h3 className={f.kicker} style={{ marginTop: 16 }}>Seat load across live mandates</h3>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Seat</th><th className={ui.num}>Hours / month</th><th>Signal</th></tr></thead>
        <tbody>{[...seatHours.entries()].map(([seat, h]) => <tr key={seat}><td>{SEATS[seat]}</td><td className={ui.num}>{h}</td><td>{h > 140 ? "Above one full-time seat: hire or contract" : h > 100 ? "Approaching capacity" : "Within one seat"}</td></tr>)}
          {seatHours.size === 0 && <tr><td colSpan={3}>No live mandates. Staffing templates: {Object.entries(STAFFING).map(([t, s]) => `${t.replace("_", " ")} (${Object.entries(s!).map(([k, v]) => `${SEATS[k as Seat]} ${v}h`).join(", ")})`).join(" · ")}</td></tr>}</tbody>
      </table></div>
      <p className={ui.sub}>Types without a template ({(Object.keys(DESKS) as string[]).length} desks) use mandate lead 10 h + origination analyst 30 h. {rows.filter(r => !STAFFING[r.m.type as MandateType]).length} mandates use that default.</p>
    </>
  );
}

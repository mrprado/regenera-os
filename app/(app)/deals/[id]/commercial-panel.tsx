import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import type { Db } from "@/db";
import { deals, deliveryTemplates, offerProposals, offerProposalVersions, services } from "@/db/schema";
import { commercialGates, commercialStageOf, stageHistory } from "@/lib/lifecycle/pipeline";
import { versionTotal } from "@/lib/lifecycle/proposals";
import { COMMERCIAL_CLOSED, COMMERCIAL_ENTRY, COMMERCIAL_FORWARD, COMMERCIAL_STAGES, FEE_STRUCTURES, PROPOSAL_STATUS } from "@/lib/lifecycle/vocab";
import { createProposalAction, moveCommercialStageAction } from "../../lifecycle-actions";

const money = (n: number | null, c: string) => (n == null ? "fee not set" : `${c} ${Math.round(n).toLocaleString("en-US")}`);

/** Commercial pipeline (phase 29A) for Regenera's paid work on this opportunity, and its versioned proposals. */
export default async function CommercialPanel({ db, deal, owner }: { db: Db; deal: typeof deals.$inferSelect; owner: boolean }) {
  const stage = commercialStageOf(deal);
  const at = COMMERCIAL_FORWARD.indexOf(stage);
  const next = at >= 0 && at < COMMERCIAL_FORWARD.length - 2 ? COMMERCIAL_FORWARD[at + 1] : null;
  const [history, proposals, svc, templates] = await Promise.all([
    stageHistory(db, "deal", deal.id),
    db.select().from(offerProposals).where(eq(offerProposals.dealId, deal.id)).orderBy(desc(offerProposals.createdAt)),
    db.select().from(services).where(eq(services.mandateId, deal.mandateId)),
    db.select().from(deliveryTemplates).where(eq(deliveryTemplates.mandateId, deal.mandateId)),
  ]);
  const latest = proposals.length ? await db.select().from(offerProposalVersions).where(eq(offerProposalVersions.proposalId, proposals[0].id)).orderBy(desc(offerProposalVersions.version)) : [];
  const nextBlockers = next ? await commercialGates(db, deal, next, "") : [];
  const active = svc.filter(s => s.active && s.offerStatus !== "retired").sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className={r.panel} id="commercial">
      <p className={r.panelTitle}><span>Commercial pipeline</span><span className={ui.chip}>{COMMERCIAL_STAGES[stage]}</span></p>
      <ol className={ui.sub} style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: "0 0 8px" }} aria-label="Commercial stages">
        {COMMERCIAL_FORWARD.map((s, i) => <li key={s} aria-current={s === stage ? "step" : undefined} style={{ fontWeight: s === stage ? 600 : 400 }}>{i > 0 ? "→ " : ""}{COMMERCIAL_STAGES[s]}</li>)}
      </ol>
      {stage === "signed" ? <p className={ui.sub}>Signed: delivery is managed on the engagement{proposals[0]?.engagementId ? <> (<Link href={`/commercial/engagements/${proposals[0].engagementId}`}>open engagement</Link>)</> : ""}.</p> : (
        <>
          {next && <p className={ui.sub}>Next: <b>{COMMERCIAL_STAGES[next]}</b>. Needs: {COMMERCIAL_ENTRY[next]}{nextBlockers.length ? <> Open: {nextBlockers.join(" ")}</> : " Ready."}</p>}
          <form action={moveCommercialStageAction} className={r.form}>
            <input type="hidden" name="dealId" value={deal.id} />
            <label>Move to<select name="stage" defaultValue={next ?? "discovery"}>{(Object.keys(COMMERCIAL_STAGES) as (keyof typeof COMMERCIAL_STAGES)[]).filter(s => s !== "signed" && s !== stage).map(s => <option key={s} value={s}>{COMMERCIAL_STAGES[s]}{COMMERCIAL_CLOSED.includes(s) ? " (close)" : ""}</option>)}</select></label>
            <label>Reason<input name="reason" placeholder="Needed to close, move back or override" /></label>
            <label>Evidence<input name="evidence" placeholder="Meeting, email or document" /></label>
            {owner && <label className={r.check}><input type="checkbox" name="override" /> Override open conditions (reason required, audited)</label>}
            <button className={ui.miniBtn} type="submit">Move</button>
          </form>
        </>
      )}
      {history.length > 0 && <ul className={r.timeline} style={{ marginTop: 10 }}>{history.map(h => <li key={h.id}><span className={r.when}>{h.at.slice(0, 10)}</span><span className={r.what}>{h.fromStage ? `${COMMERCIAL_STAGES[h.fromStage as keyof typeof COMMERCIAL_STAGES] ?? h.fromStage} → ` : ""}{COMMERCIAL_STAGES[h.toStage as keyof typeof COMMERCIAL_STAGES] ?? h.toStage}{h.override ? " (override)" : ""}{h.reason ? ` · ${h.reason}` : ""}{h.evidence ? ` · evidence: ${h.evidence}` : ""} · {h.by}</span></li>)}</ul>}

      <p className={r.panelTitle} style={{ marginTop: 16 }} id="proposals">Proposals</p>
      {proposals.length === 0 ? <p className={r.empty}>No proposal yet.</p> : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{proposals.map((p, i) => {
          const v = i === 0 ? latest[0] : undefined;
          return <li key={p.id}><Link href={`/commercial/proposals/${p.id}`}>{p.title}</Link> · {PROPOSAL_STATUS[p.status]} · v{p.currentVersion}{v ? ` · ${money(versionTotal(v), v.currency)}` : ""}</li>;
        })}</ul>
      )}
      {stage !== "signed" && (
        <form action={createProposalAction} className={r.form} style={{ marginTop: 8 }}>
          <input type="hidden" name="dealId" value={deal.id} />
          <label>Title<input name="title" defaultValue={deal.name} /></label>
          <label>Fee structure<select name="feeStructure">{Object.entries(FEE_STRUCTURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label>
          <label>Delivery template<select name="templateId" defaultValue=""><option value="">None</option>{templates.filter(t => t.status !== "retired").map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}{t.status === "draft" ? " (draft)" : ""}</option>)}</select></label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className={ui.sub}>Services (draft offers cannot be sent until approved)</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 4, maxHeight: 180, overflow: "auto" }}>
              {active.map(s => <label key={s.id} style={{ display: "flex", gap: 6, fontSize: 13 }}><input type="checkbox" name="serviceId" value={s.id} />{s.name}{s.depth !== "standard" ? ` (${s.depth})` : ""}{s.offerStatus === "draft" ? " · draft" : ""}</label>)}
            </div>
          </fieldset>
          <button className={ui.miniBtn} type="submit">Draft proposal</button>
        </form>
      )}
    </section>
  );
}

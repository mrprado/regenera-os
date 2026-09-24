import type { DossierFields } from "@/lib/crm/research";
import r from "./record.module.css";

type Sourced = { value: string | string[]; sources: string[]; confidence: string };

function host(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u.slice(0, 40); }
}

function Field({ label, f }: { label: string; f?: Sourced }) {
  const value = Array.isArray(f?.value) ? f.value.join(", ") : f?.value;
  return (
    <div className={r.fieldRow}>
      <span className={r.fieldLabel}>{label}</span>
      <span className={r.fieldValue}>
        {value ? value : <span className={r.empty}>No current, sourced information</span>}
        {f?.sources?.length ? <span className={r.sources}>{f.sources.map(s => <a key={s} href={s} target="_blank" rel="noreferrer">{host(s)}</a>)}· {f.confidence} confidence</span> : null}
      </span>
    </div>
  );
}

export default function DossierView({ status, fields, refreshedAt, depth }: { status: string; fields: Record<string, unknown> | null; refreshedAt: string | null; depth: string }) {
  if (status !== "ready" || !fields) {
    const label: Record<string, string> = { gathering: "Researching the web (current sources only)…", synthesizing: "Writing the dossier…", failed: "Research failed. Try again." };
    return <p className={r.empty}>{label[status] ?? "No dossier yet."}</p>;
  }
  const d = fields as unknown as DossierFields & { _removedUnsourced?: number };
  return (
    <>
      {d.decision_read && <p className={r.read}>{d.decision_read}</p>}
      <Field label="Mandate" f={d.mandate} />
      <Field label="Investment focus" f={d.investment_focus} />
      <Field label="Ticket and structure" f={d.ticket_and_structure} />
      <Field label="Development mandate" f={d.development_mandate} />
      <Field label="Partner ecosystem" f={d.partner_ecosystem} />
      <Field label="Decision map" f={d.decision_map} />
      <div className={r.fieldRow}>
        <span className={r.fieldLabel}>Recent activity (this year)</span>
        <span className={r.fieldValue}>
          {d.recent_activity?.length ? d.recent_activity.map((a, i) => <span key={i} style={{ display: "block", marginBottom: 4 }}><b>{a.date}</b> {a.fact} <a className={r.prov} href={a.source} target="_blank" rel="noreferrer">{host(a.source)}</a></span>) : <span className={r.empty}>Nothing current and sourced</span>}
        </span>
      </div>
      <div className={r.fieldRow}>
        <span className={r.fieldLabel}>Live opportunities</span>
        <span className={r.fieldValue}>
          {d.live_opportunities?.length ? d.live_opportunities.map((a, i) => <span key={i} style={{ display: "block", marginBottom: 4 }}>{a.fact}{a.deadline ? ` · deadline ${a.deadline}` : ""} <a className={r.prov} href={a.source} target="_blank" rel="noreferrer">{host(a.source)}</a></span>) : <span className={r.empty}>None found</span>}
        </span>
      </div>
      {d.regenerative_angle && <div className={r.fieldRow}><span className={r.fieldLabel}>Regenera angle</span><span className={r.fieldValue}>{d.regenerative_angle}</span></div>}
      <p className={r.sources} style={{ marginTop: 10 }}>
        {depth} research · refreshed {refreshedAt?.slice(0, 10)} · overall confidence {d.overall_confidence}
        {d._removedUnsourced ? ` · ${d._removedUnsourced} unsourced claims removed` : ""}
      </p>
    </>
  );
}

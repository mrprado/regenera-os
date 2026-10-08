// Investment-readiness scorecard (phase 22 rubric) with the dossier and diagnostic-proposal actions.
import Link from "next/link";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { appDb } from "@/lib/db/scoped";
import { projectReadinessScore } from "@/lib/origination/engine";
import { READING_LABEL } from "@/lib/origination/readiness";
import { buildDossierAction, proposeDiagnosticAction } from "../origination-engine-actions";

export default async function ReadinessPanel({ projectId, owner }: { projectId: string; owner: boolean }) {
  const s = await projectReadinessScore(appDb(), projectId);
  const back = `/projects/${projectId}?tab=capital`;
  return (
    <section className={r.panel} id="readiness-rubric">
      <p className={r.panelTitle}>Investment readiness · {s.templateLabel} rubric</p>
      <p><b>{READING_LABEL[s.reading]}</b>{s.score != null ? ` · ${s.score}/100` : ""} <span className={ui.sub} style={{ display: "inline" }}>· {Math.round(s.coverage * 100)}% of dimensions scored · <Link href="/origination?tab=rubric">how this is scored</Link></span></p>
      {s.blocking.length > 0 && <p className={ui.sub} style={{ color: "#7D4633" }}>Blocking: {s.blocking.join(", ")}</p>}
      <table className={ui.table}><tbody>{s.dims.map(d => (
        <tr key={d.dimension}><td>{d.label}{d.critical ? " *" : ""}</td><td>{d.score === null ? "insufficient data" : `${d.score}/3`}</td><td className={ui.wrap}><span className={ui.sub}>{d.note} · expected: {d.evidenceExpected}</span></td></tr>
      ))}</tbody></table>
      <p className={ui.sub}>* critical. Update statuses and evidence in the Readiness section; claims with sources count as evidence.</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        <form action={buildDossierAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} /><button className="btn" type="submit">Generate origination dossier</button></form>
        {owner && <form action={proposeDiagnosticAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="back" value={back} /><button className="btn btn--primary" type="submit">Draft diagnostic proposal</button></form>}
      </div>
      <p className={ui.sub}>The proposal creates a draft engagement, a proposal document with an outreach draft, and an approval task. Nothing is sent.</p>
    </section>
  );
}

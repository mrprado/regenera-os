// Funding calls matched to this project by hard gates (phase 21 §4), with the reasons and what is still unknown.
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { appDb } from "@/lib/db/scoped";
import { projectFundingMatches } from "@/lib/funding/project-match";
import { ELIGIBILITY } from "@/lib/origination/eligibility";
import { acceptFundingMatchAction, dismissFundingMatchAction } from "../funding-match-actions";

export default async function FundingMatches({ projectId }: { projectId: string }) {
  const rows = await projectFundingMatches(appDb(), projectId);
  const back = `/projects/${projectId}?tab=capital`;
  return (
    <section className={r.panel} id="funding-matches">
      <p className={r.panelTitle}>Funding calls matched ({rows.length})</p>
      <p className={ui.sub}>Open or forthcoming records that list this project&apos;s country (or global eligibility) and, where both state one, the same sector. A match is not eligibility: check the unknowns with the funder. Refreshed after every funding scan.</p>
      {rows.length === 0 ? <p className={r.empty}>No open funding record passes the gates yet. Set the project&apos;s country and technology for better matching.</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>{rows.map(m => (
          <li key={m.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <a href={m.url} target="_blank" rel="noreferrer"><b>{m.title}</b></a> <span className={ui.chip}>{m.status === "accepted" ? "Accepted" : m.geography === "listed" ? "Country listed" : "Global"}</span>
            <div className={ui.sub}>{m.funder ?? m.source} · deadline {m.deadline ?? "not stated (unverified)"}</div>
            {m.eligibility && <div className={ui.sub}><b>{ELIGIBILITY[m.eligibility]}</b>{m.capitalStage ? ` · ${m.capitalStage.replace("_", "-")} capital` : ""}</div>}
            {m.checks ? <ul className={ui.sub} style={{ margin: "2px 0", paddingLeft: 16 }}>{m.checks.map(c => <li key={c.rule}>{c.result === "pass" ? "✓" : c.result === "fail" ? "✗" : "?"} {c.rule}: {c.basis}</li>)}</ul>
              : <><div className={ui.sub}>Met: {m.reasons.met.join("; ")}</div>{m.reasons.unknown.length > 0 && <div className={ui.sub}>Unknown: {m.reasons.unknown.join("; ")}</div>}</>}
            {m.questions && m.questions.length > 0 && <div className={ui.sub}>Ask the funder: {m.questions.join(" · ")}</div>}
            {m.status === "proposed" && <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <form action={acceptFundingMatchAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Accept</button></form>
              <form action={dismissFundingMatchAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Dismiss</button></form>
            </div>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { stageRequirements } from "@/lib/mandates/fit";
import { day, label, money } from "@/lib/mandates/format";
import { candidateDetail } from "@/lib/mandates/queries";
import { simulateAll, SIM_READINGS } from "@/lib/mandates/simulation";
import { ATTRIBUTION, CANDIDATE_STAGES, CLIENT_RESPONSES, EVIDENCE_KINDS, FIT_DIMENSIONS, qualificationFor, READINGS, SIGNAL_KINDS, STAGE_ORDER, type CandidateStage, type ClientResponse, type MandateType } from "@/lib/mandates/vocab";
import { advanceCandidateAction, clientRespondAction, createPursuitAction, feedbackAction, recordCheckAction } from "../../../origination-actions";
import f from "../../../funding/funding.module.css";
import s from "../../mandates.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Candidate" };

export default async function CandidatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/mandates");
  const { id } = await params;
  const sp = await searchParams;
  const d = await candidateDetail(appDb(), user.scope, id);
  if (!d) notFound();
  const { c, m, signals, queue, account, pursuit, facts } = d;
  const type = m.type as MandateType;
  const q = qualificationFor(type);
  const idx = STAGE_ORDER.indexOf(c.stage as CandidateStage);
  const next = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
  const req = next ? stageRequirements(type, next, c.checks, { clientApproved: c.clientResponse === "approve", owner: c.owner }) : null;
  const sims = simulateAll(facts);

  return (
    <>
      <PageHeader title={c.name} />
      <Notice text={sp.notice} />
      <p className={ui.sub}><Link href={`/mandates/${m.id}?tab=universe`}>← {m.name}</Link> · {label(c.entityType)}{account ? <> · account <Link href={`/companies/${account.id}`}>{account.name}</Link></> : c.entityType === "queue_project" ? " · sponsor not published by the queue" : ""}{c.projectId ? <> · <Link href={`/projects/${c.projectId}`}>project record</Link></> : ""}</p>
      <div className={s.stagebar}>{STAGE_ORDER.map((st, i) => <span key={st} data-on={i < idx ? "done" : i === idx ? "current" : undefined}>{CANDIDATE_STAGES[st]}</span>)}</div>
      {["watch", "rejected", "excluded"].includes(c.stage) && <p className={s.caution}>Stage: {CANDIDATE_STAGES[c.stage as CandidateStage]}.</p>}

      <div className={f.layout}>
        <div>
          <h3 className={f.kicker}>Why this match: fit by dimension (basis shown; no hidden score)</h3>
          <div className={s.fitGrid}>{(Object.keys(FIT_DIMENSIONS) as (keyof typeof FIT_DIMENSIONS)[]).map(k => [
            <span key={`${k}l`}>{FIT_DIMENSIONS[k]}</span>,
            <span key={`${k}r`}><span className={s.reading} data-r={c.fit[k]?.reading ?? "unknown"}>{READINGS[(c.fit[k]?.reading ?? "unknown") as keyof typeof READINGS]}</span></span>,
            <span key={`${k}b`} className={ui.sub} style={{ margin: 0 }}>{c.fit[k]?.basis ?? "Not assessed."}</span>,
          ])}</div>

          <h3 className={f.kicker} style={{ marginTop: 18 }}>Qualification checklist</h3>
          <p className={ui.sub}>Machine-checkable criteria refresh on every screen; a person&rsquo;s answer always wins and needs a basis. {next && req ? (req.missing.length ? `To reach ${CANDIDATE_STAGES[next]}: ${req.missing.map(x => x.label).join("; ")}.` : `Ready to move to ${CANDIDATE_STAGES[next]}.`) : ""}</p>
          <div className={s.checks}>{q.map(cr => {
            const ch = c.checks[cr.key];
            return (
              <div key={cr.key} className={s.check}>
                <span className={s.reading} data-r={ch?.met ?? "unknown"}>{ch?.met ?? "unknown"}</span>
                <div><strong style={{ fontWeight: 500 }}>{cr.label}</strong><span className={ui.sub}>{cr.level}{ch ? ` · ${ch.machine ? "machine" : `${ch.by} ${day(ch.at)}`}` : ""}</span>{ch?.basis && <span className={ui.sub}>{ch.basis}</span>}</div>
                <form action={recordCheckAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="key" value={cr.key} />
                  <select name="met" defaultValue={ch?.met ?? "unknown"} aria-label="Answer"><option value="yes">yes</option><option value="no">no</option><option value="unknown">unknown</option></select>
                  <input type="text" name="basis" placeholder="Basis (source, call, document)" aria-label="Basis" />
                  <button className="btn" type="submit">Record</button></form>
              </div>
            );
          })}</div>

          {next && <form action={advanceCandidateAction} className={f.inline} style={{ marginTop: 10 }}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value={next} /><input name="reason" placeholder="Reason" aria-label="Reason" /><button className="btn" type="submit" disabled={!!req?.missing.length}>Move to {CANDIDATE_STAGES[next]}</button></form>}

          <h3 className={f.kicker} style={{ marginTop: 18 }}>Evidence</h3>
          <ul className={s.evidence}>{c.evidence.map((e, i) => <li key={i} data-k={e.kind}><span className={s.ek} data-k={e.kind}>{EVIDENCE_KINDS[e.kind]}</span>{e.text}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer">{e.source ?? "source"}</a></>}{e.observedAt && <span className={ui.sub}>observed {day(e.observedAt)}</span>}</li>)}
            {c.estValueBasis && <li data-k="inference"><span className={s.ek} data-k="inference">Model inference</span>Value {money(c.estValue)}: {c.estValueBasis}</li>}
            {c.windowBasis && <li data-k="inference"><span className={s.ek} data-k="inference">Model inference</span>Procurement window {day(c.windowStart)} → {day(c.windowEnd)}: {c.windowBasis}</li>}
          </ul>

          {queue && <>
            <h3 className={f.kicker} style={{ marginTop: 18 }}>Queue record ({queue.iso} {queue.number})</h3>
            <div className={f.grid3}>{[["State", queue.state], ["County", queue.county], ["Point of interconnection", queue.poi], ["Transmission owner", queue.transmissionOwner], ["Fuel / facility", queue.fuel], ["Summer / winter MW", `${queue.mw ?? "—"} / ${queue.mwWinter ?? "—"}`], ["Queue date", day(queue.queueDate)], ["Requested in-service", day(queue.inServiceDate)], ["Status", queue.status], ["Study", queue.studyPhase], ["Interconnection agreement", queue.iaStatus || "—"], ["Last seen", day(queue.lastSeenAt)]].map(([k, v]) => <div key={k}><span className={ui.sub}>{k}</span>{v || "—"}</div>)}</div>
            {queue.changes.length > 0 && <p className={ui.sub}>Changes: {queue.changes.slice(-6).map(x => `${day(x.at)} ${x.field}: ${x.from || "—"} → ${x.to || "—"}`).join(" · ")}</p>}
          </>}

          <h3 className={f.kicker} style={{ marginTop: 18 }}>Counterparty simulation</h3>
          <p className={s.caution}>How this opportunity is likely to look to each counterparty, from the facts the OS holds{c.projectId ? " (project readiness, constraints, permits)" : " (no project record linked: most lenses lack information)"}. Preparation only; never a substitute for legal, engineering, financial or community review.</p>
          {sims.map(x => (
            <div key={x.lens} className={s.lens}>
              <div><h4>{x.label}</h4><span className={s.reading} data-r={x.reading}>{SIM_READINGS[x.reading]}</span><span className={ui.sub}>{x.basis}</span></div>
              <div><span className={ui.sub}>{x.question}</span>
                {x.objections.length > 0 && <><strong style={{ fontWeight: 500 }}>Likely objections</strong><ul>{x.objections.map(o => <li key={o}>{o}</li>)}</ul></>}
                {x.risks.length > 0 && <><strong style={{ fontWeight: 500 }}>Critical risks</strong><ul>{x.risks.map(o => <li key={o}>{o}</li>)}</ul></>}
                {x.missing.length > 0 && <><strong style={{ fontWeight: 500 }}>Missing information</strong><ul>{x.missing.slice(0, 6).map(o => <li key={o}>{o}</li>)}</ul></>}
                {x.actions.length > 0 && <><strong style={{ fontWeight: 500 }}>Required actions</strong><ul>{x.actions.map(o => <li key={o}>{o}</li>)}</ul></>}
                {x.documents.length > 0 && <span className={ui.sub}>Documents needed: {x.documents.slice(0, 6).join("; ")}</span>}
              </div>
            </div>
          ))}
        </div>

        <aside className={f.aside}>
          <h3>Stage</h3><p>{CANDIDATE_STAGES[c.stage as CandidateStage] ?? c.stage}</p>
          <h3>Priority</h3><p>{c.priority}<span className={ui.sub}>{String(c.data.priorityWhy ?? "")}</span></p>
          <h3>Estimated value</h3><p>{money(c.estValue)} <span className={s.ek} data-k="inference">inference</span></p>
          <h3>Next action</h3><p>{c.nextAction || "—"}</p>
          <h3>Client response</h3>
          <p>{c.clientResponse ? `${CLIENT_RESPONSES[c.clientResponse as ClientResponse].label} · ${c.clientResponseBy} · ${day(c.clientResponseAt)}` : "None yet"}</p>
          {!c.clientResponse && <div className={s.respond} style={{ marginTop: 6 }}>{(Object.keys(CLIENT_RESPONSES) as ClientResponse[]).map(r => <form key={r} action={clientRespondAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="response" value={r} /><button className={r === "approve" ? "btn btn-primary" : "btn"} type="submit">{CLIENT_RESPONSES[r].label}</button></form>)}</div>}
          <h3>Attribution</h3><p>{ATTRIBUTION[c.attribution as keyof typeof ATTRIBUTION]?.label}<span className={ui.sub}>{ATTRIBUTION[c.attribution as keyof typeof ATTRIBUTION]?.note} Origin {day(c.originDate)} · {c.originator ?? "—"}{c.preExisting ? " · on the client's pre-existing list" : ""}</span></p>
          <h3>Pursuit</h3>
          {pursuit ? <p><Link href={`/pursuits/${pursuit.id}`}>{pursuit.name}</Link> · {label(pursuit.stage)}</p> : c.clientResponse === "approve" ? <form action={createPursuitAction} className={f.form}><input type="hidden" name="id" value={c.id} /><input name="owner" placeholder="Pursuit owner (email)" aria-label="Owner" /><button className="btn btn-primary" type="submit">Open pursuit</button></form> : <p className={ui.sub}>Opens after the client approves.</p>}
          <h3>Signals</h3>{signals.length ? signals.slice(0, 8).map(x => <p key={x.id} className={ui.sub}>{day(x.observedAt)} · {SIGNAL_KINDS[x.kind as keyof typeof SIGNAL_KINDS] ?? x.kind}{x.inference ? " (inference)" : ""}: {x.whatChanged}</p>) : <p className={ui.sub}>None yet.</p>}
          <h3>Match feedback</h3>
          <p className={ui.sub}>{c.feedback ? `${c.feedback}${c.feedbackNote ? `: ${c.feedbackNote}` : ""}` : "Was this match right?"}</p>
          <form action={feedbackAction} className={f.form}><input type="hidden" name="id" value={c.id} /><select name="feedback" defaultValue={c.feedback ?? "correct"} aria-label="Feedback"><option value="correct">Correct</option><option value="partial">Partial</option><option value="incorrect">Incorrect</option><option value="outdated">Outdated</option></select><input name="note" placeholder="Note" aria-label="Note" /><button className="btn" type="submit">Record</button></form>
          <h3>History</h3>{c.stageHistory.slice(-8).reverse().map((h, i) => <p key={i} className={ui.sub}>{day(h.at)} · {h.from || "—"} → {h.to} · {h.by}: {h.reason}</p>)}
        </aside>
      </div>
    </>
  );
}

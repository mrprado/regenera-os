// Organization record panels for the connected workflow (phase 15): qualification (status + six dimensions + account
// brief), coverage and relationship (buying roles, owner, attribution, reviews) and profile + objectives. Server components.
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { contacts, objectives, BASES, COVERAGE_ROLES, OBJECTIVE_KINDS, REVIEW_KINDS, QUALIFICATION_STATUSES, ATTRIBUTION_CHANNELS, type ObjectiveKind } from "@/db/schema";
import type { Db } from "@/db";
import { attributionFor, coverageFor, reviewsFor } from "@/lib/flow/commercial";
import { BASIS_LABELS, PROFILE_ROLES, profilesFor } from "@/lib/flow/profiles";
import { AUDIENCES, ORG_ROLES } from "@/lib/scan/audiences";
import { countryName } from "@/lib/scan/countries";
import { offersFor, OFFERS, MOTIONS } from "@/lib/scan/offers";
import { DIMENSIONS, qualificationFor, QUALIFICATION_LABELS, READINGS, requirementsFor } from "@/lib/scan/qualification";
import { setAccountBriefAction, setDimensionAction, setQualificationAction } from "../../scan-actions";
import { attributeAction, decideReviewAction, raiseReviewsAction, saveObjectiveAction, saveProfileAction, setCoverageAction, setRelationshipOwnerAction } from "../../flow-actions";
import p from "./panels.module.css";

type Org = { id: string; mandateId: string; name: string; ownerEmail: string | null; roles: string[] };

export async function QualificationPanel({ db, org }: { db: Db; org: Org }) {
  const q = await qualificationFor(db, org.mandateId, org.id);
  const back = `/companies/${org.id}?tab=qualification`;
  const status = q?.status ?? "discovered";
  const offers = q?.audience ? offersFor(q.audience) : [];
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Qualification</span><span>{q ? `${QUALIFICATION_LABELS[status]} · rubric ${q.rubricVersion}` : "Not assessed"}</span></p>
        <p className={ui.sub} style={{ marginTop: 0 }}>Six separate readings, each with a basis; there is no combined score. Scans can only set Discovered or Matches criteria; every later status is a person&apos;s decision with a reason. Qualifying never creates an opportunity by itself.</p>
        <ol className={p.ladder}>{QUALIFICATION_STATUSES.filter(s => s !== "disqualified" && s !== "parked").map(s => <li key={s} data-current={s === status ? "" : undefined}>{QUALIFICATION_LABELS[s]}</li>)}</ol>
        <form action={setQualificationAction} className={p.row}>
          <input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="back" value={back} />
          <label>Move to<select name="to" defaultValue="">{<option value="" disabled>Choose</option>}{QUALIFICATION_STATUSES.map(s => <option key={s} value={s}>{QUALIFICATION_LABELS[s]}</option>)}</select></label>
          <label className={p.grow}>Reason (required)<input name="reason" required minLength={3} placeholder="What you checked" /></label>
          <button className={ui.miniBtn} type="submit">Record</button>
        </form>
        {q && <p className={ui.sub}>Before Ready for outreach: {requirementsFor("ready_for_outreach", q, "x").join(" ") || "met"}. Before Qualified opportunity: {requirementsFor("qualified_opportunity", q, "x").join(" ") || "met"}.</p>}
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}>Readings</p>
        <div className={p.dims}>{(Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]).map(k => {
          const d = q?.dimensions[k];
          return (
            <form key={k} action={setDimensionAction} className={p.dim}>
              <input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="dimension" value={k} /><input type="hidden" name="back" value={back} />
              <b>{DIMENSIONS[k]}</b>
              <span className={ui.sub}>{d ? `${READINGS[d.reading]} · ${d.basis}${d.by ? ` · ${d.by === "scan" ? "machine screen" : d.by}` : ""}${d.at ? ` · ${d.at.slice(0, 10)}` : ""}` : "Unknown: not assessed"}</span>
              <div className={p.row}>
                <select name="reading" defaultValue={d?.reading ?? "unknown"} aria-label={`${DIMENSIONS[k]} reading`}>{Object.entries(READINGS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input name="basis" placeholder="Basis (what evidence)" aria-label={`${DIMENSIONS[k]} basis`} className={p.grow} />
                <input name="source" placeholder="Source URL or record" aria-label={`${DIMENSIONS[k]} source`} />
                <button className={ui.miniBtn} type="submit">Save</button>
              </div>
            </form>
          );
        })}</div>
      </section>
      {q && q.criteria.length > 0 && (
        <section className={r.panel}>
          <p className={r.panelTitle}>Latest screen against the scan criteria</p>
          <ul className={r.timeline}>{q.criteria.map(c => <li key={c.key}><span className={r.when}>{c.result}</span><span><b>{c.label}</b>: {c.evidence}</span></li>)}</ul>
        </section>
      )}
      <section className={r.panel}>
        <p className={r.panelTitle}>Account brief</p>
        <form action={setAccountBriefAction} className={p.stack}>
          <input type="hidden" name="orgId" value={org.id} />
          <label>Who they are<textarea name="who" rows={2} defaultValue={q?.who ?? ""} /></label>
          <label>The relevant decision or project<textarea name="decision" rows={2} defaultValue={q?.decision ?? ""} /></label>
          <label>Why now (sourced)<textarea name="whyNow" rows={2} defaultValue={q?.whyNow ?? ""} /></label>
          <label>Entry offer<input name="entryOffer" list="offers" defaultValue={q?.entryOffer ?? ""} /></label>
          <datalist id="offers">{(offers.length ? offers : OFFERS).map(o => <option key={o.key} value={o.entryOffer}>{o.name}</option>)}</datalist>
          <label>Next action<input name="nextAction" defaultValue={q?.nextAction ?? ""} /></label>
          <button className={ui.miniBtn} type="submit">Save brief</button>
        </form>
        {offers.length > 0 && <div className={ui.sub}><b>Offers for this audience:</b><ul>{offers.map(o => <li key={o.key}>{o.name} ({MOTIONS[o.motion]}): {o.problem} Next: {o.nextStep}.</li>)}</ul></div>}
      </section>
    </>
  );
}

export async function CoveragePanel({ db, org }: { db: Db; org: Org }) {
  const [cov, people, reviews, attr] = await Promise.all([
    coverageFor(db, org.mandateId, org.id),
    db.select({ id: contacts.id, name: contacts.fullName, title: contacts.title }).from(contacts).where(and(eq(contacts.mandateId, org.mandateId), eq(contacts.orgId, org.id))).orderBy(asc(contacts.fullName)).limit(200),
    reviewsFor(db, org.mandateId, org.id), attributionFor(db, org.mandateId, "organization", org.id),
  ]);
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Account coverage</span><span>Unknown roles stay unknown</span></p>
        <div className={ui.tableWrap}><table className={ui.table}>
          <thead><tr><th>Role</th><th>Person</th><th>Relationship owner</th><th>Last interaction</th><th>Next step</th><th /></tr></thead>
          <tbody>{Object.entries(COVERAGE_ROLES).map(([k, label]) => {
            const c = cov.find(x => x.c.role === k);
            return (
              <tr key={k}>
                <td className={ui.primary}>{label}</td>
                <td colSpan={5}>
                  <form action={setCoverageAction} className={p.row}>
                    <input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="role" value={k} />
                    <select name="contactId" defaultValue={c?.c.contactId ?? ""} aria-label={`${label}: person`}><option value="">Unknown</option>{people.map(x => <option key={x.id} value={x.id}>{x.name}{x.title ? `, ${x.title}` : ""}</option>)}</select>
                    <input name="owner" defaultValue={c?.c.relationshipOwner ?? ""} placeholder="Owner email" aria-label={`${label}: relationship owner`} />
                    <span className={ui.sub} style={{ minWidth: 90 }}>{c?.lastInteraction ? c.lastInteraction.slice(0, 10) : "None recorded"}</span>
                    <input name="nextAction" defaultValue={c?.c.nextAction ?? ""} placeholder="Next step" aria-label={`${label}: next step`} className={p.grow} />
                    <input name="evidence" defaultValue={c?.c.evidence ?? ""} placeholder="Evidence (how you know)" aria-label={`${label}: evidence`} />
                    <button className={ui.miniBtn} type="submit">Save</button>
                  </form>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {people.length === 0 && <p className={ui.sub}>No people recorded at this organization yet. Add them from People, or run a people search from a scan.</p>}
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}>Relationship owner</p>
        <form action={setRelationshipOwnerAction} className={p.row}>
          <input type="hidden" name="orgId" value={org.id} />
          <input name="owner" defaultValue={org.ownerEmail ?? ""} placeholder="One accountable person (email)" aria-label="Relationship owner" className={p.grow} />
          <button className={ui.miniBtn} type="submit">Save</button>
        </form>
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Source attribution</span><span>First row = original source</span></p>
        {attr.length === 0 ? <p className={r.empty}>No source recorded.</p> : <ul className={r.timeline}>{attr.map(a => <li key={a.id}><span className={r.when}>{a.kind === "original" ? "Original" : "Influence"}</span><span>{ATTRIBUTION_CHANNELS[a.channel as keyof typeof ATTRIBUTION_CHANNELS] ?? a.channel}{a.campaign ? ` · ${a.campaign}` : ""}{a.scanRunId ? <> · <Link href={`/scans/${a.scanRunId}`}>scan</Link></> : null}<span className={ui.sub}>{a.at.slice(0, 10)} · {a.by}{a.note ? ` · ${a.note}` : ""}</span></span></li>)}</ul>}
        <form action={attributeAction} className={p.row}>
          <input type="hidden" name="entityType" value="organization" /><input type="hidden" name="entityId" value={org.id} />
          <select name="channel" aria-label="Channel">{Object.entries(ATTRIBUTION_CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input name="campaign" placeholder="Campaign" aria-label="Campaign" /><input name="note" placeholder="Note (e.g. introduced by …)" aria-label="Note" className={p.grow} />
          <button className={ui.miniBtn} type="submit">Record source</button>
        </form>
      </section>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Conflicts and relationship reviews</span><form action={raiseReviewsAction}><input type="hidden" name="orgId" value={org.id} /><button className={ui.miniBtn} type="submit">Check records for conflicts</button></form></p>
        <p className={ui.sub} style={{ marginTop: 0 }}>Flags from records (open deals, other workspaces, referral claims, active sequences, suppression) for a person to decide. Not a legal conflicts check.</p>
        {reviews.length === 0 ? <p className={r.empty}>None raised.</p> : <ul className={r.timeline}>{reviews.map(v => (
          <li key={v.id}><span className={r.when}>{v.status}</span><span><b>{REVIEW_KINDS[v.kind as keyof typeof REVIEW_KINDS] ?? v.kind}</b>: {v.detail}<span className={ui.sub}>{v.origin === "auto" ? "Raised from records" : `Raised by ${v.raisedBy}`}{v.decidedBy ? ` · ${v.status} by ${v.decidedBy}: ${v.reason}` : ""}</span>
            {v.status === "open" && <form action={decideReviewAction} className={p.row}><input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="id" value={v.id} /><input name="reason" required placeholder="Reason" aria-label="Reason" className={p.grow} /><button className={ui.miniBtn} name="status" value="cleared" type="submit">Clear</button><button className={ui.miniBtn} name="status" value="blocked" type="submit">Block</button></form>}</span></li>
        ))}</ul>}
      </section>
    </>
  );
}

export async function ProfilePanel({ db, org }: { db: Db; org: Org }) {
  const [profiles, objs] = await Promise.all([profilesFor(db, org.mandateId, org.id), db.select().from(objectives).where(and(eq(objectives.mandateId, org.mandateId), eq(objectives.orgId, org.id)))]);
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Objectives</span><span>{objs.length}</span></p>
        <p className={ui.sub} style={{ marginTop: 0 }}>The center of the workflow: what this party wants. Each objective gets its own scan, shortlist, owner and next action.</p>
        {objs.length > 0 && <ul className={r.timeline}>{objs.map(o => <li key={o.id}><span className={r.when}>{o.status}</span><span><Link href={`/objectives/${o.id}`}>{o.title}</Link><span className={ui.sub}>{OBJECTIVE_KINDS[o.kind as ObjectiveKind] ?? o.kind}{o.owner ? ` · owner ${o.owner}` : ""}</span></span></li>)}</ul>}
        <details className={p.details}><summary>New objective for {org.name}</summary>
          <form action={saveObjectiveAction} className={p.stack}>
            <input type="hidden" name="orgId" value={org.id} />
            <label>What they want<select name="kind" defaultValue="find_contracts">{Object.entries(OBJECTIVE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Title<input name="title" required placeholder={`${org.name}: contracts in Mexico (solar + BESS)`} /></label>
            <label>Desired outcome<textarea name="desiredOutcome" rows={2} /></label>
            <label>Capabilities / scope (comma separated)<input name="capabilities" placeholder="solar PV, BESS, substations, EPC turnkey" /></label>
            <label>Geography (countries or regions, comma separated)<input name="geography" placeholder="Mexico, United States" /></label>
            <div className={p.row}><label>Size from<input name="sizeMin" inputMode="decimal" /></label><label>to<input name="sizeMax" inputMode="decimal" /></label><label>Unit<input name="sizeUnit" placeholder="MW" /></label></div>
            <label>Stages wanted (comma separated)<input name="stages" placeholder="development, construction" /></label>
            <label>Hard exclusions (comma separated)<input name="exclusions" placeholder="residential, coal" /></label>
            <label>Audience to find (for partner, capital or client objectives)<select name="targetAudience" defaultValue=""><option value="">Not needed</option>{AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
            <label>Timing<input name="timing" placeholder="earliest mobilization Q2 2027" /></label>
            <label>Where these criteria came from<input name="source" placeholder="Meeting 2026-10-01 with VP BD" /></label>
            <button className="btn btn--primary" type="submit">Save objective</button>
          </form>
        </details>
      </section>
      {Object.entries(PROFILE_ROLES).map(([role, def]) => {
        const pr = profiles.find(x => x.role === role);
        return (
          <details key={role} className={`${r.panel} ${p.details}`} open={!!pr}>
            <summary>{def.label} profile {pr ? `· reviewed ${pr.reviewedAt?.slice(0, 10) ?? ""}` : "· not recorded"}</summary>
            <form action={saveProfileAction} className={p.stack}>
              <input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="role" value={role} />
              <label>Operating coverage (where they actually operate; not the headquarters)<input name="coverage" defaultValue={pr?.coverage.map(countryName).join(", ") ?? ""} /></label>
              <label>Coverage basis<select name="coverageBasis" defaultValue={pr?.coverageBasis ?? "stated"}>{BASES.map(b => <option key={b} value={b}>{BASIS_LABELS[b]}</option>)}</select></label>
              {def.fields.map(f => {
                const v = pr?.fields[f.key];
                return (
                  <div key={f.key} className={p.field}>
                    <label>{f.label}<input name={`v_${f.key}`} defaultValue={v?.value ?? ""} placeholder={f.hint} /></label>
                    <select name={`b_${f.key}`} defaultValue={v?.basis ?? "stated"} aria-label={`${f.label}: basis`}>{BASES.map(b => <option key={b} value={b}>{BASIS_LABELS[b]}</option>)}</select>
                    <input name={`s_${f.key}`} defaultValue={v?.source ?? ""} placeholder="Source" aria-label={`${f.label}: source`} />
                  </div>
                );
              })}
              <button className={ui.miniBtn} type="submit">Save {def.label.toLowerCase()} profile</button>
            </form>
          </details>
        );
      })}
      <p className={ui.sub}>Roles this organization holds for Regenera are set under Identity: {org.roles.length ? org.roles.map(x => ORG_ROLES[x as keyof typeof ORG_ROLES] ?? x).join(", ") : "none yet"}.</p>
    </>
  );
}

import Link from "next/link";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import type { Db } from "@/db";
import { attributions, organizations, partnerships, relationshipIntroductions, relationshipStatus } from "@/db/schema";
import { stageHistory } from "@/lib/lifecycle/pipeline";
import { rolesFor } from "@/lib/lifecycle/relationships";
import { CAPTURE_CHANNELS, DERIVED_ROLES, INTRO_OUTCOMES, PARTNERSHIP_KINDS, PARTNERSHIP_STAGES, RELATIONSHIP_ROLES, RELATIONSHIP_STAGES, type PartnershipStage } from "@/lib/lifecycle/vocab";
import {
  addRoleAction, captureContactAction, endRoleAction, introductionAction, introductionOutcomeAction, movePartnershipAction, partnershipAction, relationshipStageAction,
} from "./lifecycle-actions";

const inline = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 } as const;

/** Relationship (phase 29B): overlapping roles (client roles only from engagements), stage, next action, source, history. */
export async function RelationshipPanel({ db, mandateId, entityType, entityId }: { db: Db; mandateId: string; entityType: "contact" | "organization"; entityId: string }) {
  const [roles, [status], history, sources] = await Promise.all([
    rolesFor(db, mandateId, entityType, entityId),
    db.select().from(relationshipStatus).where(and(eq(relationshipStatus.mandateId, mandateId), eq(relationshipStatus.entityType, entityType), eq(relationshipStatus.entityId, entityId))),
    stageHistory(db, entityType, entityId),
    db.select().from(attributions).where(and(eq(attributions.mandateId, mandateId), eq(attributions.entityType, entityType), eq(attributions.entityId, entityId))).orderBy(attributions.at).limit(10),
  ]);
  const current = roles.filter(x => !x.until);
  const hidden = (n: string, v: string) => <input type="hidden" name={n} value={v} />;
  const ids = <>{hidden("entityType", entityType)}{hidden("entityId", entityId)}</>;
  return (
    <section className={r.panel} id="relationship">
      <p className={r.panelTitle}><span>Relationship</span><span className={ui.chip}>{status ? RELATIONSHIP_STAGES[status.stage] : "Not tracked"}</span></p>
      <p className={ui.sub} style={{ marginTop: 0 }}>Roles can overlap. Client and former client come only from agreed engagements.</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {current.length === 0 && <span className={ui.sub}>No roles recorded.</span>}
        {current.map(x => <span key={x.id} className={DERIVED_ROLES.includes(x.role) ? ui.chipReed : ui.chip} title={`${x.basis}${x.source ? ` · ${x.source}` : ""}${x.since ? ` · since ${x.since}` : ""}`}>{RELATIONSHIP_ROLES[x.role]}{x.basis === "verified" ? " ✓" : ""}</span>)}
      </div>
      <details style={{ marginTop: 6 }}><summary className={ui.sub} style={{ cursor: "pointer" }}>Add or end a role</summary>
        <form action={addRoleAction} style={inline}>{ids}
          <select name="role" aria-label="Role">{Object.entries(RELATIONSHIP_ROLES).filter(([k]) => !DERIVED_ROLES.includes(k as never)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label className={ui.sub}><input type="checkbox" name="verified" /> verified</label><input name="note" placeholder="Basis (optional)" aria-label="Basis" />
          <button className={ui.miniBtn} type="submit">Add role</button></form>
        {current.filter(x => !DERIVED_ROLES.includes(x.role)).map(x => <form key={x.id} action={endRoleAction} style={inline}>{ids}{hidden("role", x.role)}<button className={ui.miniBtn} type="submit">End {RELATIONSHIP_ROLES[x.role].toLowerCase()}</button></form>)}
      </details>
      {status && <p className={ui.sub}>Next: {status.nextAction || (status.noActionReason ? `none (${status.noActionReason})` : "not set")}{status.nextActionDue ? ` · due ${status.nextActionDue}` : ""}{status.owner ? ` · ${status.owner}` : ""}</p>}
      <form action={relationshipStageAction} className={r.form}>{ids}
        <div className={r.formRow}>
          <label>Stage<select name="stage" defaultValue={status?.stage ?? "identified"}>{Object.entries(RELATIONSHIP_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Next action<input name="nextAction" defaultValue={status?.nextAction ?? ""} /></label>
          <label>Due<input type="date" name="nextActionDue" defaultValue={status?.nextActionDue ?? ""} /></label>
        </div>
        <div className={r.formRow}><label>Or why no action is scheduled<input name="noActionReason" defaultValue={status?.noActionReason ?? ""} /></label><label>Reason (to close or go dormant)<input name="reason" /></label></div>
        <button className={ui.miniBtn} type="submit">Save relationship</button>
      </form>
      {sources.length > 0 && <p className={ui.sub}>Source: {sources.map(s => `${s.kind === "original" ? "first" : "later"}: ${s.channel}${s.campaign ? ` (${s.campaign})` : ""}${s.note ? ` · ${s.note}` : ""}`).join(" | ")}</p>}
      {history.length > 0 && <ul className={r.timeline}>{history.slice(-6).map(h => <li key={h.id}><span className={r.when}>{h.at.slice(0, 10)}</span><span className={r.what}>{h.fromStage ? `${RELATIONSHIP_STAGES[h.fromStage as keyof typeof RELATIONSHIP_STAGES] ?? h.fromStage} → ` : ""}{RELATIONSHIP_STAGES[h.toStage as keyof typeof RELATIONSHIP_STAGES] ?? h.toStage}{h.reason ? ` · ${h.reason}` : ""}</span></li>)}</ul>}
    </section>
  );
}

const NEXT_P: Partial<Record<PartnershipStage, PartnershipStage>> = { potential: "capability_verified", capability_verified: "discussion", discussion: "proposed_arrangement", proposed_arrangement: "agreed", agreed: "active", active: "review" };

/** Partnerships with this organization (phase 29B): verified capability, arrangement, agreement; no assumed fees. */
export async function PartnershipPanel({ db, mandateId, orgId }: { db: Db; mandateId: string; orgId: string }) {
  const ps = await db.select().from(partnerships).where(and(eq(partnerships.mandateId, mandateId), eq(partnerships.orgId, orgId)));
  return (
    <section className={r.panel} id="partnership">
      <p className={r.panelTitle}>Partnership</p>
      {ps.map(p => {
        const next = NEXT_P[p.stage];
        const field = next === "capability_verified" ? ["evidence", "Evidence (references, certifications, past work)"] : next === "proposed_arrangement" ? ["arrangement", "What is proposed"] : next === "agreed" ? ["evidence", "Agreement evidence (signed copy, email)"] : null;
        return (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{PARTNERSHIP_KINDS[p.kind]} · {PARTNERSHIP_STAGES[p.stage]}</p>
            <p className={ui.sub}>{p.capabilities.join(", ") || "Capabilities not listed"}{p.geographies.length ? ` · ${p.geographies.join(", ")}` : ""}{p.verifiedAt ? ` · verified ${p.verifiedAt.slice(0, 10)}: ${p.capabilityEvidence}` : " · capability not verified"}</p>
            {p.arrangement && <p className={ui.sub}>Arrangement: {p.arrangement}</p>}
            <p className={ui.sub}>Commercial terms: {p.commercialTerms || "none recorded (no fee is assumed)"}</p>
            {next && <form action={movePartnershipAction} style={inline}><input type="hidden" name="partnershipId" value={p.id} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="to" value={next} />
              {field && <input name={field[0]} placeholder={field[1]} aria-label={field[1]} required style={{ minWidth: 240 }} />}
              {next === "agreed" && <input name="commercialTerms" placeholder="Agreed terms, if any" aria-label="Agreed terms" />}
              <button className={ui.miniBtn} type="submit">{PARTNERSHIP_STAGES[next]}</button></form>}
            {p.stage !== "closed" && <details style={{ display: "inline-block" }}><summary className={ui.sub} style={{ cursor: "pointer" }}>Close</summary><form action={movePartnershipAction} style={inline}><input type="hidden" name="partnershipId" value={p.id} /><input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="to" value="closed" /><input name="reason" placeholder="Reason" aria-label="Reason" required /><button className={ui.miniBtn} type="submit">Close partnership</button></form></details>}
          </div>
        );
      })}
      <details><summary className={ui.sub} style={{ cursor: "pointer" }}>{ps.length ? "Add or update a partnership" : "Record as a potential partner"}</summary>
        <form action={partnershipAction} className={r.form}><input type="hidden" name="orgId" value={orgId} />
          <div className={r.formRow}><label>Kind<select name="kind">{Object.entries(PARTNERSHIP_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Capacity<input name="capacity" /></label></div>
          <label>Capabilities (comma separated)<input name="capabilities" /></label><label>Geographies<input name="geographies" /></label>
          <button className={ui.miniBtn} type="submit">Save partnership</button></form>
      </details>
    </section>
  );
}

/** Introductions this organization is part of, with authorization and outcome. Nothing is sent from here. */
export async function IntroductionsPanel({ db, mandateId, orgId }: { db: Db; mandateId: string; orgId: string }) {
  const [list, orgs] = await Promise.all([
    db.select().from(relationshipIntroductions).where(and(eq(relationshipIntroductions.mandateId, mandateId), or(eq(relationshipIntroductions.fromOrgId, orgId), eq(relationshipIntroductions.toOrgId, orgId)))).orderBy(desc(relationshipIntroductions.createdAt)).limit(20),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.mandateId, mandateId), isNull(organizations.archivedAt))).orderBy(organizations.name).limit(500),
  ]);
  const name = (id: string | null) => orgs.find(o => o.id === id)?.name ?? "—";
  return (
    <section className={r.panel} id="introductions">
      <p className={r.panelTitle}>Introductions</p>
      {list.length === 0 ? <p className={r.empty}>None recorded.</p> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{list.map(i => (
        <li key={i.id} style={{ marginBottom: 6 }}><Link href={`/companies/${i.fromOrgId}`}>{name(i.fromOrgId)}</Link> → <Link href={`/companies/${i.toOrgId}`}>{name(i.toOrgId)}</Link> · {i.purpose} · {INTRO_OUTCOMES[i.outcome]}
          <span className={ui.sub}>{i.authorization ? `Authorized: ${i.authorization}` : "No sharing authorization recorded"}{i.materialsShared.length ? ` · shared: ${i.materialsShared.join(", ")}` : ""}{i.outcomeNote ? ` · ${i.outcomeNote}` : ""}</span>
          {i.openKey && <form action={introductionOutcomeAction} style={inline}><input type="hidden" name="introductionId" value={i.id} /><input type="hidden" name="orgId" value={orgId} />
            <select name="outcome" aria-label="Outcome">{(["meeting_held", "engaged", "declined", "no_response", "withdrawn"] as const).map(k => <option key={k} value={k}>{INTRO_OUTCOMES[k]}</option>)}</select><input name="note" placeholder="Note" aria-label="Note" /><button className={ui.miniBtn} type="submit">Record outcome</button></form>}
        </li>))}</ul>}
      <details><summary className={ui.sub} style={{ cursor: "pointer" }}>Record an introduction from this organization</summary>
        <form action={introductionAction} className={r.form}><input type="hidden" name="fromOrgId" value={orgId} />
          <label>Introduced to<select name="toOrgId" required>{orgs.filter(o => o.id !== orgId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Purpose<input name="purpose" required /></label>
          <label>Materials shared (one per line)<textarea name="materials" rows={2} /></label>
          <label>Authorization to share (who agreed, how)<input name="authorization" /></label>
          <div className={r.formRow}><label>Date<input type="date" name="date" /></label><label>Next action<input name="nextAction" /></label></div>
          <button className={ui.miniBtn} type="submit">Record introduction</button></form>
      </details>
    </section>
  );
}

/** Record a person met at an event, on LinkedIn, through friends or an informal introduction. */
export function CaptureContactForm({ mandates }: { mandates: { id: string; name: string }[] }) {
  return (
    <section className={r.panel} id="capture">
      <p className={r.panelTitle}>Record a contact or introduction</p>
      <p className={ui.sub}>For people met at events, on LinkedIn, through friends or informal introductions. The source and referrer are kept, a next action is created, and nobody becomes a client.</p>
      <form action={captureContactAction} className={r.form}>
        {mandates.length > 1 && <label>Workspace<select name="mandateId">{mandates.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
        <div className={r.formRow}><label>Name<input name="name" required /></label><label>Email<input name="email" type="email" /></label></div>
        <div className={r.formRow}><label>Organization<input name="organization" /></label><label>Title<input name="title" /></label></div>
        <div className={r.formRow}>
          <label>How you met<select name="channel">{Object.entries(CAPTURE_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Role<select name="role" defaultValue="acquaintance">{Object.entries(RELATIONSHIP_ROLES).filter(([k]) => !DERIVED_ROLES.includes(k as never)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <div className={r.formRow}><label>Introduced by (name)<input name="referrerName" /></label><label>Their email<input name="referrerEmail" type="email" /></label></div>
        <label>Context<textarea name="note" rows={2} /></label>
        <div className={r.formRow}><label>Next action<input name="nextAction" required placeholder="e.g. send the intro note, follow up after the event" /></label><label>Due<input type="date" name="nextActionDue" /></label></div>
        <button className="btn btn--primary" type="submit">Record</button>
      </form>
    </section>
  );
}

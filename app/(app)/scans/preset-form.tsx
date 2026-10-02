"use client";

// Full scan preset form (phase 16 §2). Every saved setting is editable here and round-trips through lib/scan/preset-form.ts;
// on an error nothing is saved and the form keeps what was typed. Mode decides which sources are offered, so an opportunity
// preset cannot silently run organization discovery.
import { useActionState, useMemo, useState } from "react";
import { savePresetAction, type PresetFormState } from "../scan-actions";
import s from "./scans.module.css";

type Opt = { value: string; label: string };
type Props = {
  initial: Record<string, string | string[]>;
  sections: Opt[]; audiences: Opt[]; objectives: Opt[];
  providers: { key: string; label: string; scope: "external" | "workspace"; mode: "organizations" | "opportunities" | "both"; note: string }[];
  geo: { groups: Opt[]; countries: (Opt & { region: string })[] };
  limits: Record<string, number>;
  editing: boolean;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export function PresetForm(p: Props) {
  const [state, action, pending] = useActionState<PresetFormState, FormData>(savePresetAction, { errors: [], values: null, seq: 0 });
  const v = state.values ?? p.initial;
  // Remount the fields with the returned values after a failed save, so nothing typed is lost.
  return <PresetFields key={state.seq} {...p} values={v} action={action} pending={pending} errors={state.errors} />;
}

function PresetFields(p: Props & { values: Record<string, string | string[]>; action: (fd: FormData) => void; pending: boolean; errors: string[] }) {
  const v = p.values;
  const [mode, setMode] = useState(first(v.mode) || "organizations");
  const [geo, setGeo] = useState<string[]>(many(v.geography));
  const [q, setQ] = useState("");
  const labelOf = useMemo(() => new Map([...p.geo.groups, ...p.geo.countries].map(o => [o.value, o.label])), [p.geo]);
  const matches = q.trim().length < 2 ? [] : [...p.geo.groups, ...p.geo.countries].filter(o => o.label.toLowerCase().includes(q.trim().toLowerCase()) || o.value.toLowerCase() === q.trim().toLowerCase()).slice(0, 12);
  const toggle = (code: string) => setGeo(g => (g.includes(code) ? g.filter(x => x !== code) : [...g, code]));
  const L = p.limits;
  const shown = p.providers.filter(x => x.mode === "both" || x.mode === mode);
  const chosen = many(v.providers);

  return (
    <form action={p.action} className={s.start} aria-describedby={p.errors.length ? "preset-errors" : undefined}>
      {p.errors.length > 0 && (
        <div id="preset-errors" role="alert" className={s.errors}><b>Not saved.</b><ul>{p.errors.map(e => <li key={e}>{e}</li>)}</ul></div>
      )}
      <label>Name<input name="name" required minLength={3} maxLength={L.name} defaultValue={first(v.name)} /><span className={s.hint}>Saving under the same name updates that preset.</span></label>
      <label>Section<select name="section" defaultValue={first(v.section) || "prospecting"}>{p.sections.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <fieldset className={s.fs}><legend>What the scan looks for</legend>
        <label><input type="radio" name="mode" value="organizations" checked={mode === "organizations"} onChange={() => setMode("organizations")} /> Organizations (companies, investors, partners)</label>
        <label><input type="radio" name="mode" value="opportunities" checked={mode === "opportunities"} onChange={() => setMode("opportunities")} /> Projects and opportunities (tenders, packages, funding calls, queues)</label>
      </fieldset>
      {mode === "organizations"
        ? <label>Audience<select name="audience" defaultValue={first(v.audience)}>{p.audiences.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        : <input type="hidden" name="audience" value="objective" />}
      <label>Objective (optional)<select name="objectiveId" defaultValue={first(v.objectiveId)}><option value="">None</option>{p.objectives.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>

      <fieldset className={s.fs}><legend>Geography</legend>
        <span className={s.hint}>Empty means worldwide (no country filter). Regions expand to their countries; GCC is part of MENA but MENA is not GCC.</span>
        <div className={s.chips} aria-live="polite">{geo.length === 0 ? <span className={s.hint}>Worldwide</span> : geo.map(g => (
          <button key={g} type="button" className={s.chip} onClick={() => toggle(g)} aria-label={`Remove ${labelOf.get(g) ?? g}`}>{labelOf.get(g) ?? g} ×</button>))}</div>
        {geo.map(g => <input key={g} type="hidden" name="geography" value={g} />)}
        <label>Find a country or region<input value={q} onChange={e => setQ(e.target.value)} placeholder="Type 2+ letters: United States, GCC, Zimbabwe" aria-controls="geo-results" /></label>
        {matches.length > 0 && <ul id="geo-results" className={s.geoList}>{matches.map(o => (
          <li key={o.value}><label><input type="checkbox" checked={geo.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}</label></li>))}</ul>}
        <label>Or paste a list (comma, semicolon or one per line)<textarea name="geographyText" rows={2} maxLength={L.geography} defaultValue={first(v.geographyText)} placeholder="United States; UK; UAE; Namibia" /></label>
      </fieldset>

      <label>{mode === "organizations" ? "Extra organization terms" : "Opportunity terms"}<textarea name="terms" rows={2} maxLength={L.terms} defaultValue={first(v.terms)} placeholder="grid connection, repowering, BESS, permitting" /><span className={s.hint}>Comma, semicolon or newline separated. Up to {L.terms} characters.</span></label>
      <label>Exclude when mentioned<textarea name="excludeTerms" rows={2} maxLength={L.excludeTerms} defaultValue={first(v.excludeTerms)} placeholder="residential, coal" /></label>
      {mode === "organizations" && <label>Audience&apos;s built-in exclusions<select name="audienceExclusions" defaultValue={first(v.audienceExclusions) || "apply"}><option value="apply">Apply them (the exclusions above are added)</option><option value="ignore">Turn them off for this preset</option></select><span className={s.hint}>An empty exclusions box means no extra exclusions; the audience&apos;s own still apply unless turned off here.</span></label>}

      {mode === "organizations" ? (
        <>
          <label>Sector (optional)<input name="sector" maxLength={L.sector} defaultValue={first(v.sector)} /></label>
          <div className={s.pair}><label>Min headcount<input name="headcountMin" inputMode="numeric" defaultValue={first(v.headcountMin)} /></label><label>Max headcount<input name="headcountMax" inputMode="numeric" defaultValue={first(v.headcountMax)} /></label></div>
          <label>Decision-maker titles (empty = the audience&apos;s)<textarea name="titles" rows={2} maxLength={L.titles} defaultValue={first(v.titles)} /></label>
          <label>Seniorities (empty = the audience&apos;s)<input name="seniorities" maxLength={L.seniorities} defaultValue={first(v.seniorities)} placeholder="c_suite, vp, director" /></label>
          <label>Buying events to look for<textarea name="signalCriteria" rows={2} maxLength={L.signalCriteria} defaultValue={first(v.signalCriteria)} placeholder="new market entry, fund close, interconnection agreement" /><span className={s.hint}>Recorded as questions for review; a scan does not prove intent.</span></label>
        </>
      ) : (
        <>
          <label>Capabilities (technologies and scope)<textarea name="capabilities" rows={2} maxLength={L.capabilities} defaultValue={first(v.capabilities)} placeholder="solar PV, BESS, EPC" /></label>
          <div className={s.pair}><label>Min size<input name="sizeMin" inputMode="decimal" defaultValue={first(v.sizeMin)} /></label><label>Max size<input name="sizeMax" inputMode="decimal" defaultValue={first(v.sizeMax)} /></label><label>Unit<input name="sizeUnit" maxLength={L.sizeUnit} defaultValue={first(v.sizeUnit)} placeholder="MW" /></label></div>
          <label>Stages<input name="stages" maxLength={L.stages} defaultValue={first(v.stages)} placeholder="rfp, tender, development" /></label>
        </>
      )}
      <label>Freshness (days a source may be old)<input name="freshnessDays" inputMode="numeric" defaultValue={first(v.freshnessDays) || "365"} /></label>

      <fieldset className={s.fs}><legend>Sources</legend>
        {(["external", "workspace"] as const).map(scope => {
          const list = shown.filter(x => x.scope === scope);
          return list.length ? <div key={scope} className={s.srcGroup}><span className={s.hint}>{scope === "external" ? "External discovery (can find new records)" : "Workspace matching (records already held; never counted as new)"}</span>
            {list.map(x => <label key={x.key} title={x.note}><input type="checkbox" name="providers" value={x.key} defaultChecked={chosen.includes(x.key)} /> {x.label}</label>)}</div> : null;
        })}
      </fieldset>

      <div className={s.pair}>
        <label>Max new organizations<input name="maxOrganizations" inputMode="numeric" defaultValue={first(v.maxOrganizations) || "50"} /></label>
        {mode === "organizations" && <label>People per organization<input name="maxPeoplePerOrg" inputMode="numeric" defaultValue={first(v.maxPeoplePerOrg) || "0"} /></label>}
      </div>
      <label>Research budget (USD of Claude spend, open web)<input name="researchBudgetUsd" inputMode="decimal" defaultValue={first(v.researchBudgetUsd) || "3"} /></label>
      <p className={s.hint}>Fixed for every scan: each result needs human review; duplicates are merged only on strong identifiers (domain, LEI, provider ID); contact enrichment is never run by a scan.</p>
      <label>Note<input name="note" maxLength={L.note} defaultValue={first(v.note)} /></label>
      <button className="btn btn--primary" type="submit" disabled={p.pending}>{p.pending ? "Saving…" : p.editing ? "Save changes" : "Save preset"}</button>
    </form>
  );
}

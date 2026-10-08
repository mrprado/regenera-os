import { env } from "cloudflare:workers";
import { asc } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import ui from "@/components/ui.module.css";
import { integrations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner } from "@/lib/db/scoped";
import { integrationHealth } from "@/lib/integrations/engine";
import { PROBES } from "@/lib/integrations/adapters";
import { CANDIDATES, candidateStatus, STATUS_LABEL, type CandidateStatus } from "@/lib/integrations/candidates";
import { downstreamCounts } from "@/lib/integrations/downstream";
import { sourceHealth, isDegraded } from "@/lib/sources/http";
import { seedIntegrationsAction, setIntegrationStateAction, testIntegrationAction } from "../../place-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

const STATE_LABEL = { enabled: "Enabled", development_only: "Development only", license_required: "Licence required", disabled: "Disabled" } as const;

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/integrations");
  const sp = await searchParams;
  const db = appDb();
  const [rows, health, downstream] = await Promise.all([db.select().from(integrations).orderBy(asc(integrations.category), asc(integrations.provider)), integrationHealth(db), downstreamCounts(db)]);
  const cool = new Map(await Promise.all(rows.map(async r => [r.key, await sourceHealth(db, r.key)] as const)));
  const registry = new Set(rows.map(r => r.key));
  const lastOk = new Map([...health.values()].filter(h => h.lastSuccess).map(h => [h.key, h.lastSuccess!]));
  const cands = CANDIDATES.map(c => ({ ...c, status: candidateStatus(c, registry, lastOk, downstream) }));
  const statusCount = (s: CandidateStatus) => cands.filter(c => c.status === s).length;
  const domains = [...new Set(cands.map(c => c.domain))];
  const owner = isOwner(user.scope);
  const vars = env as unknown as Record<string, string | undefined>;
  return (
    <>
      <Notice text={sp.notice} />
      <p className={ui.notice}>Every external source, its licence and what we may do with its data. A public API is not an unrestricted commercial licence. Disabled and licence-required sources are never called. Health comes from the call ledger. Test makes one real call; keys are read server-side and never shown.</p>
      {rows.length === 0 ? (
        <form action={seedIntegrationsAction}><button className="btn btn--primary" type="submit" disabled={!owner}>Load the integration registry</button></form>
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Source</th><th>Licence and use</th><th>Access</th><th>Health (24 h)</th><th>State</th></tr></thead>
            <tbody>{rows.map(i => {
              const h = health.get(i.key);
              const credential = i.envVar ? (vars[i.envVar] ? "Credential set" : "Integration ready: credential required") : "No credential needed";
              return (
                <tr key={i.key}>
                  <td><b>{i.provider}</b><span className={ui.sub}>{i.dataset} · {i.category} · {i.coverage} · Tier {i.sourceTier}</span>{i.notes && <span className={ui.sub}>{i.notes}</span>}</td>
                  <td className={ui.wrap}>{i.licenseUrl ? <a href={i.licenseUrl} target="_blank" rel="noreferrer">{i.license}</a> : i.license}
                    <span className={ui.sub}>Commercial: {i.commercialUse} · Attribution: {i.attribution} · Caching: {i.caching} · Redistribution: {i.redistribution}</span></td>
                  <td>{i.auth === "none" ? "Open" : i.auth}{i.envVar && <span className={ui.sub}>{i.envVar}: {credential}</span>}<span className={ui.sub}>{i.rateLimit} · refresh {i.refresh}</span></td>
                  <td>{downstream.has(i.key) && <span className={ui.sub} style={{ color: (downstream.get(i.key) ?? 0) > 0 ? "#246448" : "#7D4633" }}>{(downstream.get(i.key) ?? 0).toLocaleString("en-US")} records reached the OS</span>}
                    {isDegraded(cool.get(i.key)!) && <span className={ui.sub} style={{ color: "#7D4633" }}>Degraded: {cool.get(i.key)!.failures} consecutive failures · cooling down until {cool.get(i.key)!.until?.slice(11, 16)} UTC</span>}
                    {h ? <>{h.calls24h} calls, {h.failures24h} failed<span className={ui.sub} style={{ color: h.failures24h ? "#b0432f" : undefined }}>Last success {h.lastSuccess?.slice(0, 16).replace("T", " ") ?? "never"}{h.lastError && h.failures24h ? ` · ${h.lastError.slice(0, 80)}` : ""}</span></> : <span className={ui.chipMuted}>No calls yet</span>}
                    {owner && PROBES.includes(i.key) && i.featureState !== "disabled" && i.featureState !== "license_required" && <form action={testIntegrationAction} style={{ marginTop: 4 }}><input type="hidden" name="key" value={i.key} /><button className={ui.miniBtn} type="submit">Test</button></form>}</td>
                  <td>{owner ? (
                    <form action={setIntegrationStateAction} style={{ display: "flex", gap: 4 }}>
                      <input type="hidden" name="key" value={i.key} />
                      <select name="state" defaultValue={i.featureState} aria-label={`${i.provider} state`}>{Object.entries(STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <button className={ui.miniBtn} type="submit">Set</button>
                    </form>
                  ) : STATE_LABEL[i.featureState]}{i.stateOverridden && <span className={ui.sub}>Changed by an owner</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <h2 style={{ marginTop: 32 }}>Global source registry</h2>
      <p className={ui.notice}>Every source in the master registry ({cands.length}), with its documented access method, authentication, tier (1 public · 2 regional/country · 3 commercial · 4 research) and licence posture. Status is computed: {(["reaching", "ingesting", "tested", "registered", "candidate"] as CandidateStatus[]).map(s => `${STATUS_LABEL[s]}: ${statusCount(s)}`).join(" · ")}. A candidate is not a claim that a free API exists; Tier 3 sources are never activated without approval.</p>
      {domains.map(d => (
        <details key={d} className={ui.wrap} style={{ margin: "8px 0" }}><summary><b>{d}</b> <span className={ui.sub} style={{ display: "inline" }}>{cands.filter(c => c.domain === d).length} sources · {cands.filter(c => c.domain === d && (c.status === "reaching" || c.status === "ingesting")).length} live</span></summary>
          <div className={ui.tableWrap}><table className={ui.table}><thead><tr><th>Source</th><th>Access</th><th>Tier</th><th>Licence</th><th>Status</th></tr></thead>
            <tbody>{cands.filter(c => c.domain === d).map(c => <tr key={c.name}>
              <td><a href={c.url} target="_blank" rel="noreferrer">{c.name}</a>{c.note && <span className={ui.sub}>{c.note}</span>}</td>
              <td>{c.access}<span className={ui.sub}>auth: {c.auth}</span></td><td>{c.tier}</td><td className={ui.wrap}>{c.licence}</td>
              <td>{STATUS_LABEL[c.status]}{c.registryKey && downstream.has(c.registryKey) && <span className={ui.sub}>{(downstream.get(c.registryKey) ?? 0).toLocaleString("en-US")} records</span>}</td>
            </tr>)}</tbody></table></div>
        </details>
      ))}
    </>
  );
}

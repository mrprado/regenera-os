import { env } from "cloudflare:workers";
import { asc } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import ui from "@/components/ui.module.css";
import { integrations } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isOwner } from "@/lib/db/scoped";
import { integrationHealth } from "@/lib/integrations/engine";
import { PROBES } from "@/lib/integrations/adapters";
import { seedIntegrationsAction, setIntegrationStateAction, testIntegrationAction } from "../../place-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

const STATE_LABEL = { enabled: "Enabled", development_only: "Development only", license_required: "Licence required", disabled: "Disabled" } as const;

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/settings/integrations");
  const sp = await searchParams;
  const db = appDb();
  const [rows, health] = await Promise.all([db.select().from(integrations).orderBy(asc(integrations.category), asc(integrations.provider)), integrationHealth(db)]);
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
                  <td>{h ? <>{h.calls24h} calls, {h.failures24h} failed<span className={ui.sub} style={{ color: h.failures24h ? "#b0432f" : undefined }}>Last success {h.lastSuccess?.slice(0, 16).replace("T", " ") ?? "never"}{h.lastError && h.failures24h ? ` · ${h.lastError.slice(0, 80)}` : ""}</span></> : <span className={ui.chipMuted}>No calls yet</span>}
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
    </>
  );
}

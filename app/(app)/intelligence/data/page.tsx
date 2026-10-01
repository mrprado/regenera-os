import Link from "next/link";
import { env } from "cloudflare:workers";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal } from "@/lib/db/scoped";
import { DATASETS, LAYER_LIBRARY, PROVIDERS } from "@/lib/data-providers/catalog";
import { ensureDataRegistry, HEALTH_LABEL, providerHealth, recentSyncs } from "@/lib/data-providers/engine";
import { withBase } from "@/lib/base-path";
import { EVIDENCE_LEVELS, CONNECTION, DATA_CATEGORIES } from "@/lib/data-providers/types";
import { KNOWLEDGE_VS_OPEN } from "@/lib/data-providers/governance";
import f from "../../funding/funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data" };

const TABS = [["catalog", "Catalogue"], ["providers", "Providers"], ["health", "Health"], ["licences", "Licences"], ["evidence", "Evidence levels"], ["layers", "Layer library"]] as const;
const yn = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "Verify");

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/intelligence/data");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "catalog";
  const e = env as unknown as Record<string, string | undefined>;
  await ensureDataRegistry(appDb());
  const health = await providerHealth(appDb(), e);
  const q = sp.q?.toLowerCase().trim();
  const rows = health.flatMap(h => h.datasets).filter(x => (!q || `${x.d.name} ${x.d.provider} ${x.d.platform} ${x.d.category} ${x.d.geography} ${x.d.analyticalRole}`.toLowerCase().includes(q)) && (!sp.category || x.d.category === sp.category) && (!sp.provider || x.d.provider === sp.provider));
  const internal = isInternal(user.scope);
  return (
    <>
      <PageHeader title="Data" count={DATASETS.length} />
      <Notice text={sp.notice} />
      <p className={ui.notice}>Institutional data providers, normalized: every layer, site-intelligence value, export and AI answer cites a dataset here with its licence, version, analytical role and limitation. Status reflects real adapter results; nothing is shown as live unless a call succeeded. Open institutional data is governed separately from community-governed knowledge.</p>
      <nav className={ui.tabs} aria-label="Data views">
        {TABS.filter(([k]) => k !== "health" || internal).map(([k, v]) => <Link key={k} className={`${ui.tab} ${tab === k ? ui.tabActive : ""}`} href={k === "catalog" ? "/intelligence/data" : `/intelligence/data?tab=${k}`}>{v}</Link>)}
      </nav>

      {tab === "catalog" && (
        <>
          <form action={withBase("/intelligence/data")} className={f.inline} style={{ marginBottom: 12 }}>
            <input name="q" defaultValue={sp.q} placeholder="water stress Mexico, tree cover, energy access…" aria-label="Search datasets" style={{ minWidth: 280 }} />
            <select name="category" defaultValue={sp.category ?? ""} aria-label="Category"><option value="">All categories</option>{Object.entries(DATA_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select name="provider" defaultValue={sp.provider ?? ""} aria-label="Provider"><option value="">All providers</option>{PROVIDERS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
            <button className="btn" type="submit">Search</button>
          </form>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead><tr><th>Dataset</th><th>Provider · platform</th><th>Category</th><th>Geography · resolution</th><th>Access</th><th>Status</th><th>Licence</th><th>Commercial</th><th>Evidence</th></tr></thead>
              <tbody>{rows.map(({ d, row, s }) => (
                <tr key={d.id}>
                  <td className={ui.wrap}><span className={ui.primary}>{d.name}</span><span className={ui.sub}>{d.analyticalRole}</span></td>
                  <td><Link href={`/intelligence/data/${d.provider}`}>{PROVIDERS.find(p => p.key === d.provider)?.name}</Link><span className={ui.sub}>{PROVIDERS.find(p => p.key === d.provider)?.platforms.find(pl => pl.key === d.platform)?.name ?? ""}</span></td>
                  <td>{DATA_CATEGORIES[d.category]}</td>
                  <td className={ui.wrap}>{d.geography}<span className={ui.sub}>{[d.spatialResolution, d.temporalCoverage].filter(Boolean).join(" · ")}</span></td>
                  <td>{d.sourceType}{d.earthEngineAsset && <span className={ui.sub}>EE: {d.earthEngineAsset}</span>}</td>
                  <td><span className={f.state} data-s={s.connection === "connected" ? "confirmed" : s.health === "failing" ? "blocked" : "uncertain"}>{CONNECTION[s.connection].label}</span><span className={ui.sub}>{HEALTH_LABEL[s.health]}{row?.lastSuccessAt ? ` · ${row.lastSuccessAt.slice(0, 10)}` : ""}</span></td>
                  <td className={ui.wrap}>{d.licenseUrl ? <a href={d.licenseUrl} target="_blank" rel="noreferrer">{d.license}</a> : d.license}</td>
                  <td>{yn(d.commercialUse)}</td>
                  <td>Level {d.evidenceLevel}{d.screeningOnly && <span className={ui.sub}>screening only</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {rows.length === 0 && <p className={r.empty}>No dataset matches. Search covers names, providers, categories, geography and analytical role.</p>}
        </>
      )}

      {tab === "providers" && (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Provider</th><th>Tier</th><th>Platforms</th><th className={ui.num}>Datasets</th><th className={ui.num}>Connected</th><th>Last sync</th></tr></thead>
            <tbody>{health.map(h => (
              <tr key={h.p.key}><td className={ui.wrap}><Link className={ui.primary} href={`/intelligence/data/${h.p.key}`}>{h.p.name}</Link><span className={ui.sub}>{h.p.tagline}</span></td><td>{h.p.tier === 1 ? "Tier 1 · institutional" : `Tier ${h.p.tier}`}</td>
                <td className={ui.sub}>{h.p.platforms.map(pl => pl.name).join(", ")}</td><td className={ui.num}>{h.datasets.length}</td><td className={ui.num}>{h.connected}</td><td>{h.lastSync?.slice(0, 16).replace("T", " ") ?? "Never"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === "health" && internal && <Health health={health} syncs={await recentSyncs(appDb())} />}

      {tab === "licences" && (
        <>
          <p className={ui.sub}>Before export: datasets whose redistribution is not allowed are never packaged raw; exports carry the analysis, citation, source URL and methodology instead. &quot;Verify&quot; means the terms must be checked before commercial use.</p>
          <div className={ui.tableWrap}><table className={ui.table}>
            <thead><tr><th>Dataset</th><th>Licence</th><th>Commercial</th><th>Redistribution</th><th>Derivatives</th><th>Cache</th><th>Attribution</th></tr></thead>
            <tbody>{DATASETS.map(d => <tr key={d.id}><td>{d.name}</td><td>{d.license}</td><td>{yn(d.commercialUse)}</td><td>{yn(d.redistribution)}</td><td>{yn(d.derivatives)}</td><td>{yn(d.cacheAllowed)}</td><td className={ui.sub}>{d.attributionText}</td></tr>)}</tbody>
          </table></div>
          <section className={r.panel} style={{ marginTop: 14 }}>
            <p className={r.panelTitle}>Two governance models, never merged</p>
            <div className={f.grid2}>{KNOWLEDGE_VS_OPEN.map(g => <div key={g.title}><b>{g.title}</b><ul>{g.items.map(i => <li key={i}>{i}</li>)}</ul></div>)}</div>
          </section>
        </>
      )}

      {tab === "evidence" && (
        <div className={f.grid3}>{Object.entries(EVIDENCE_LEVELS).map(([k, v]) => (
          <section key={k} className={r.panel}><p className={r.panelTitle}>{v.label}</p><p style={{ fontSize: 13 }}>{v.use}</p>
            <p className={ui.sub}>{k === "1" ? "WRI, World Bank, NASA, ESA, Copernicus, FAO, OpenStreetMap, Global Solar / Wind Atlas" : k === "2" ? "Grid operator, municipality, land registry, environmental / water authority, energy regulator, planning office" : "Interconnection study, PPA, lease / title, EIA, hydrology, geotechnical, engineering, resource assessment, financial model, legal opinions, survey"}</p></section>
        ))}</div>
      )}

      {tab === "layers" && (
        <div className={f.grid3}>{Object.entries(LAYER_LIBRARY).map(([g, items]) => (
          <section key={g} className={r.panel}><p className={r.panelTitle}>{g}</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{items.map(i => { const ds = DATASETS.filter(d => d.atlasGroup === g && d.name.toLowerCase().includes(i.toLowerCase().split(" ")[0])); return <li key={i}>{i}{ds.length ? <span className={ui.sub}> · {ds.map(d => d.name).join(", ")}</span> : null}</li>; })}</ul>
          </section>
        ))}</div>
      )}
    </>
  );
}

function Health({ health, syncs }: { health: Awaited<ReturnType<typeof providerHealth>>; syncs: Awaited<ReturnType<typeof recentSyncs>> }) {
  return (
    <>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>Provider</th><th className={ui.num}>Datasets</th><th>Connection</th><th>API health</th><th>Last sync</th><th className={ui.num}>Failures</th><th>Licence review</th></tr></thead>
          <tbody>{health.map(h => (
            <tr key={h.p.key}><td><Link href={`/intelligence/data/${h.p.key}`}>{h.p.name}</Link></td><td className={ui.num}>{h.datasets.length}</td><td>{h.connected} connected</td>
              <td className={ui.sub}>{h.platforms.map(pl => `${pl.name}: ${HEALTH_LABEL[pl.health]}`).join(" · ")}</td><td>{h.lastSync?.slice(0, 16).replace("T", " ") ?? "Never"}</td>
              <td className={`${ui.num} ${h.failures ? f.warn : ""}`}>{h.failures}</td><td>{h.licenseVerify ? `${h.licenseVerify} to verify` : "Clear"}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className={ui.sub}>Alerts: failing syncs (3+ consecutive), stale datasets (no success in 45 days), missing keys and deprecated sources show here and in Settings → Integrations. Status reflects actual adapter state; nothing is inferred.</p>
      <section className={r.panel}>
        <p className={r.panelTitle}>Recent sync jobs</p>
        {syncs.length === 0 ? <p className={r.empty}>No syncs yet. Open a provider and use Sync now.</p> : <table className={ui.table}><tbody>{syncs.map(s => <tr key={s.id}><td>{s.startedAt.slice(0, 16).replace("T", " ")}</td><td>{s.datasetId}</td><td className={s.status === "failed" ? f.warn : undefined}>{s.status}</td><td className={ui.sub}>{s.detail}</td></tr>)}</tbody></table>}
      </section>
    </>
  );
}


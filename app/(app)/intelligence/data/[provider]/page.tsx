import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Notice } from "@/components/crm-bits";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { dataProviders, projectDatasetLinks } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb, isInternal } from "@/lib/db/scoped";
import { providerOf } from "@/lib/data-providers/catalog";
import { ensureDataRegistry, HEALTH_LABEL, providerHealth } from "@/lib/data-providers/engine";
import { CONNECTION } from "@/lib/data-providers/types";
import { licenseReviewedAction, syncDatasetAction, syncProviderAction } from "../../../data-actions";
import f from "../../../funding/funding.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data provider" };
const yn = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "Verify");

export default async function ProviderPage({ params, searchParams }: { params: Promise<{ provider: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireOsUser("/intelligence/data");
  const { provider } = await params;
  const sp = await searchParams;
  const p = providerOf(provider);
  if (!p) notFound();
  const e = env as unknown as Record<string, string | undefined>;
  await ensureDataRegistry(appDb());
  const h = (await providerHealth(appDb(), e)).find(x => x.p.key === provider)!;
  const [meta] = await appDb().select().from(dataProviders).where(eq(dataProviders.key, provider));
  const links = await appDb().select({ datasetId: projectDatasetLinks.datasetId }).from(projectDatasetLinks);
  const used = new Map<string, number>();
  for (const l of links) used.set(l.datasetId, (used.get(l.datasetId) ?? 0) + 1);
  const internal = isInternal(user.scope);
  const back = `/intelligence/data/${provider}`;
  return (
    <>
      <PageHeader title={p.name.toUpperCase()} actions={<><a className="btn" href={p.url} target="_blank" rel="noreferrer">Provider site</a><Link className="btn" href="/intelligence/data">All data</Link></>} />
      <p className={f.kicker}>{p.tagline} · {p.tier === 1 ? "Tier 1 · institutional data provider" : `Tier ${p.tier}`}</p>
      <Notice text={sp.notice} />
      <dl className={f.strip}>
        <div><dt>Provider status</dt><dd>{h.connected ? `${h.connected} dataset(s) connected` : "No live connection yet"}</dd></div>
        <div><dt>API status</dt><dd>{h.platforms.map(pl => HEALTH_LABEL[pl.health]).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</dd></div>
        <div><dt>Datasets registered</dt><dd>{h.datasets.length}</dd></div>
        <div><dt>Regions covered</dt><dd>{[...new Set(h.datasets.map(x => x.d.geography.split(" (")[0]))].slice(0, 3).join(", ")}</dd></div>
        <div><dt>Last sync</dt><dd>{h.lastSync?.slice(0, 16).replace("T", " ") ?? "Never"}</dd></div>
        <div><dt>Licensing</dt><dd>{h.licenseVerify ? `${h.licenseVerify} to verify` : "Recorded"}{meta?.licenseReviewedBy ? ` · reviewed ${meta.licenseReviewedAt?.slice(0, 10)}` : ""}</dd></div>
        <div><dt>Used by projects</dt><dd>{h.datasets.reduce((a, x) => a + (used.get(x.d.id) ?? 0), 0)} links</dd></div>
      </dl>
      {internal && (
        <div className={ui.rowActions} style={{ marginBottom: 14 }}>
          <form action={syncProviderAction}><input type="hidden" name="provider" value={p.key} /><button className="btn btn--primary" type="submit">Sync now</button></form>
          <form action={licenseReviewedAction}><input type="hidden" name="provider" value={p.key} /><button className="btn" type="submit">Record licence review</button></form>
          <span className={ui.sub}>Sync makes real calls (catalogue lookups and metadata). Consuming modules: Atlas, site intelligence, project screening, capital attributes, exports.</span>
        </div>
      )}
      {p.platforms.map(pl => {
        const ds = h.datasets.filter(x => x.d.platform === pl.key);
        const ph = h.platforms.find(x => x.key === pl.key)!;
        return (
          <details key={pl.key} className={r.panel} open={ds.length > 0 && ds.length < 12}>
            <summary className={r.panelTitle} style={{ cursor: "pointer" }}><span>{pl.name} · {ds.length} dataset(s)</span><span className={ui.sub}>{HEALTH_LABEL[ph.health]} · <a href={pl.url} target="_blank" rel="noreferrer">platform</a></span></summary>
            <p className={ui.sub} style={{ marginTop: 0 }}>{pl.note}</p>
            {ds.length === 0 ? <p className={r.empty}>No datasets registered on this platform yet.</p> : (
              <table className={ui.table}>
                <thead><tr><th>Dataset</th><th>Status</th><th>Access</th><th>Version · coverage</th><th>Licence · commercial · redistribution</th><th>Role and limitation</th>{internal && <th />}</tr></thead>
                <tbody>{ds.map(({ d, row, s }) => (
                  <tr key={d.id}>
                    <td className={ui.wrap}><b>{d.name}</b><span className={ui.sub}>{d.id}{d.methodologyUrl ? <> · <a href={d.methodologyUrl} target="_blank" rel="noreferrer">methodology</a></> : null}</span></td>
                    <td>{CONNECTION[s.connection].label}<span className={ui.sub}>{HEALTH_LABEL[s.health]}{row?.lastError ? ` · ${row.lastError.slice(0, 80)}` : ""}</span></td>
                    <td>{d.sourceType}{d.envVar && <span className={ui.sub}>{s.needsKey ? `needs ${d.envVar}` : `${d.envVar} set`}</span>}{d.earthEngineAsset && <span className={ui.sub}>{d.earthEngineAsset}</span>}</td>
                    <td className={ui.wrap}>{d.version ?? "—"}<span className={ui.sub}>{[d.geography, d.spatialResolution, d.temporalCoverage, d.scenarios?.join(", ")].filter(Boolean).join(" · ")}</span></td>
                    <td className={ui.wrap}>{d.license}<span className={ui.sub}>commercial {yn(d.commercialUse)} · redistribution {yn(d.redistribution)}</span></td>
                    <td className={ui.wrap}>{d.analyticalRole}<span className={ui.sub}>{d.limitations.join("; ")}</span></td>
                    {internal && <td>{d.adapter && ["resource_watch", "gfw"].includes(d.adapter) && <form action={syncDatasetAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} /><button className={ui.miniBtn} type="submit">Sync</button></form>}</td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </details>
        );
      })}
      <p className={ui.sub}>{p.name} appears as data provenance, not as a co-branded product. Attribution: {h.datasets[0]?.d.attributionText ?? "per dataset"}.</p>
    </>
  );
}

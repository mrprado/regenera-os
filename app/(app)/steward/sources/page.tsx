import Link from "next/link";
import { asc } from "drizzle-orm";
import { PageHeader } from "@/components/page";
import ui from "@/components/ui.module.css";
import { stewardSources } from "@/db/schema";
import { requireOsUser } from "@/lib/auth";
import { appDb } from "@/lib/db/scoped";
import { STEWARD_SOURCES } from "@/lib/steward/sources/catalog";
import { MEXICO_SOURCES } from "@/lib/steward/sources/packs";
import s from "../steward.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Steward sources" };

const HEALTH: Record<string, string> = {
  verified: "Verified", unverified: "Unverified", credential_required: "Credential required", license_required: "Licence required", unsupported: "Not supported yet", unavailable: "Unavailable", failing: "Failing",
};
const RIGHT: Record<string, string> = { allowed: "Allowed", conditional: "Conditional", prohibited: "Prohibited", unknown: "Unknown", license_required: "Licence required" };

/** The Steward source register (phase 28B): what each source is, its rights, and its verified status. */
export default async function SourcesPage() {
  await requireOsUser("/steward/sources");
  const rows = await appDb().select().from(stewardSources).orderBy(asc(stewardSources.region), asc(stewardSources.accessMethod), asc(stewardSources.name));
  // Before the first scheduled run the register may be empty: show the catalogue, marked as such.
  const list = rows.length ? rows : [...STEWARD_SOURCES, ...MEXICO_SOURCES].map(x => ({ ...x, lastCheckedAt: null, lastSuccessAt: null, latestObservation: null }));
  return (
    <>
      <PageHeader title="Steward sources" actions={<Link className="btn" href="/steward">Steward</Link>} />
      <p className={s.lede}>Every source Steward uses or has considered, with its access method, licence, commercial-use, redistribution and AI rights (kept separate), and the status verified for it. A source is switched on only when a live request succeeded and its terms allow Regenera&apos;s commercial use. &quot;Last checked&quot;, &quot;last success&quot; and &quot;latest observation&quot; are different things.</p>
      {!rows.length && <p className={ui.notice}>The register has not been written to the database yet (it is on the next scheduled run, or the first &quot;Query now&quot; on a place). Showing the catalogue.</p>}
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Source</th><th>Status</th><th>Rights</th><th>Freshness</th><th>Limits</th></tr></thead>
        <tbody>{list.map(x => (
          <tr key={x.key}>
            <td><a href={x.homepage} target="_blank" rel="noreferrer">{x.name}</a><span className={ui.sub}>{x.provider} · {x.accessMethod}{x.region && x.region !== "global" ? ` · ${x.region}` : ""}{x.datasetVersion ? ` · ${x.datasetVersion}` : ""}</span>{x.docsUrl && <span className={ui.sub}><a href={x.docsUrl} target="_blank" rel="noreferrer">Documentation</a></span>}</td>
            <td><span className={s.state} data-s={x.health === "verified" ? "done" : x.health === "failing" ? "blocked" : "not_assessed"}>{HEALTH[x.health ?? "unverified"] ?? x.health}</span><span className={ui.sub}>{x.enabled ? "Enabled" : "Disabled"}{x.blockedReason ? `: ${x.blockedReason}` : ""}</span>{x.verificationNote && <span className={ui.sub}>{x.verificationNote}</span>}</td>
            <td>{x.licenseUrl ? <a href={x.licenseUrl} target="_blank" rel="noreferrer">{x.licenseName || "Licence"}</a> : x.licenseName || "—"}<span className={ui.sub}>Commercial: {RIGHT[x.commercialUse ?? "unknown"]} · Redistribution: {RIGHT[x.redistribution ?? "unknown"]} · AI: {RIGHT[x.aiProcessing ?? "unknown"]}</span>{x.attribution && <span className={ui.sub}>Attribution: {x.attribution}</span>}<span className={ui.sub}>Auth: {x.auth}{x.quotas ? ` · ${x.quotas}` : ""}</span></td>
            <td>Checked {x.lastCheckedAt?.slice(0, 10) ?? "never"}<span className={ui.sub}>Last success {x.lastSuccessAt?.slice(0, 10) ?? "never"} · latest observation {x.latestObservation?.slice(0, 10) ?? "unknown"}</span><span className={ui.sub}>Refresh policy: {x.refreshDays ? `every ${x.refreshDays} days` : "not polled"}{x.cadence ? ` · provider: ${x.cadence}` : ""}</span></td>
            <td className={ui.wrap}>{x.coverageLimits || "—"}<span className={ui.sub}>{[x.geographicCoverage, x.temporalCoverage, x.resolution].filter(Boolean).join(" · ")}</span></td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

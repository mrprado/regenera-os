import { asc, eq } from "drizzle-orm";
import r from "@/components/record.module.css";
import ui from "@/components/ui.module.css";
import { placeFacts } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { PLACE_DIMENSIONS, PLACE_GAPS } from "@/lib/place/engine";
import { buildPlaceAction } from "../place-actions";

const TIER: Record<number, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3", 4: "Tier 4", 5: "Tier 5" };

/** Place profile: every fact shows its source, tier, licence, period and retrieval date; gaps stay visible. */
export default async function PlaceTab({ project }: { project: { id: string; lat: number | null; lng: number | null; country: string | null } }) {
  const facts = await appDb().select().from(placeFacts).where(eq(placeFacts.projectId, project.id)).orderBy(asc(placeFacts.dimension), asc(placeFacts.label));
  const latest = facts.reduce<string | null>((a, f) => (!a || f.retrievedAt > a ? f.retrievedAt : a), null);
  const stale = facts.filter(f => f.state === "stale");
  return (
    <>
      <section className={r.panel}>
        <p className={r.panelTitle}><span>Place profile</span>
          <form action={buildPlaceAction}><input type="hidden" name="id" value={project.id} /><button className={`${ui.miniBtn} ${ui.miniPrimary}`} type="submit">{facts.length ? "Refresh" : "Build place profile"}</button></form></p>
        <p className={ui.sub} style={{ marginTop: 0 }}>
          {project.lat === null ? "Set the project coordinates on the Overview tab for site-level facts (solar, climate, infrastructure, seismic, biodiversity). " : `Site ${project.lat}, ${project.lng}. `}
          Facts come from NASA POWER, World Bank, OpenStreetMap, USGS and GBIF, each with its tier and licence. They describe context and are not a site assessment.
          {latest ? ` Last retrieved ${latest.slice(0, 10)}.` : ""}
        </p>
        {stale.length > 0 && <p className={ui.notice}>Source unavailable at the last refresh: showing {stale.length} values synchronized earlier ({[...new Set(stale.map(s => s.integrationKey))].join(", ")}).</p>}
      </section>
      <div className={r.grid}>
        <div>
          {(Object.keys(PLACE_DIMENSIONS) as (keyof typeof PLACE_DIMENSIONS)[]).map(dim => {
            const rows = facts.filter(f => f.dimension === dim);
            return (
              <section key={dim} className={r.panel}>
                <p className={r.panelTitle}>{PLACE_DIMENSIONS[dim]}</p>
                {rows.length > 0 && (
                  <table className={ui.table}><tbody>{rows.map(f => (
                    <tr key={f.id}>
                      <td>{f.label}<span className={ui.sub}>{f.observedFor ?? ""}</span></td>
                      <td><b>{f.value}</b>{f.state === "stale" && <span className={ui.sub} style={{ color: "#b0432f" }}>stale</span>}</td>
                      <td className={ui.sub}>{f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.integrationKey}</a> : f.integrationKey} · {TIER[f.tier] ?? ""} · {f.retrievedAt.slice(0, 10)}<br />{f.license}</td>
                    </tr>
                  ))}</tbody></table>
                )}
                <p className={ui.sub}>Not covered by automated sources: {PLACE_GAPS[dim].join("; ")}.</p>
              </section>
            );
          })}
        </div>
        <aside>
          <section className={r.panel}>
            <p className={r.panelTitle}>Attribution</p>
            <p className={ui.sub} style={{ marginTop: 0 }}>© OpenStreetMap contributors (ODbL). Data: NASA POWER; World Bank (CC BY 4.0); USGS; GBIF-mediated occurrence data (aggregate counts only). Licensed layers (Protected Planet, IBAT) are off until licences exist; see Settings → Integrations.</p>
          </section>
        </aside>
      </div>
    </>
  );
}

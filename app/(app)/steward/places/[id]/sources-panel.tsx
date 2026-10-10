import { and, desc, eq } from "drizzle-orm";
import ui from "@/components/ui.module.css";
import { stewardSourceRecords } from "@/db/schema";
import { appDb } from "@/lib/db/scoped";
import { placeSourceStates } from "@/lib/steward/sources/pipeline";
import { DATA_STATES } from "@/lib/steward/vocab";
import { runSourceAction } from "../../actions";
import s from "../../steward.module.css";

const ACCESS: Record<string, string> = { api: "API", download: "Download", reference: "Reference", manual: "Manual import", licensed: "Licence required" };

/** Sources for a place (phase 28B): state per source, what was asked and found, and the stored records with provenance. */
export default async function SourcesPanel({ placeId, owner }: { placeId: string; owner: boolean }) {
  const db = appDb();
  const [states, records] = await Promise.all([
    placeSourceStates(db, placeId),
    db.select().from(stewardSourceRecords).where(and(eq(stewardSourceRecords.placeId, placeId))).orderBy(desc(stewardSourceRecords.observedStart)).limit(60),
  ]);
  const data = states.filter(x => x.source.accessMethod !== "reference");
  return (
    <section className={s.card} id="sources" style={{ marginTop: 16 }}>
      <h2>Sources and evidence<span>{records.length} records stored</span></h2>
      <p className={s.empty}>Each source shows when it was last checked, what it returned and its limits. &quot;No matching records&quot;, a failure or a blocked source never means low risk or absence.</p>
      <div className={ui.tableWrap}><table className={ui.table}>
        <thead><tr><th>Source</th><th>State for this place</th><th>Last query</th><th></th></tr></thead>
        <tbody>{data.map(({ source, last, state }) => (
          <tr key={source.key}>
            <td>{source.name}<span className={ui.sub}>{source.provider} · {ACCESS[source.accessMethod] ?? source.accessMethod} · licence: {source.licenseName || "not stated"} · commercial use: {source.commercialUse}</span></td>
            <td><span className={s.state} data-s={state}>{DATA_STATES[state]}</span>{last?.error && <span className={ui.sub}>{last.error}</span>}{!source.enabled && !last && <span className={ui.sub}>{source.blockedReason}</span>}</td>
            <td>{last ? <>{last.startedAt.slice(0, 16).replace("T", " ")}<span className={ui.sub}>{last.recordCount} records{last.excludedCount ? ` · ${last.excludedCount} excluded by licence` : ""}{last.latestObservation ? ` · latest observation ${last.latestObservation.slice(0, 10)}` : ""}</span>{last.limitations && <span className={ui.sub}>{last.limitations}</span>}</> : "Never"}</td>
            <td>{source.enabled && <form action={runSourceAction}><input type="hidden" name="placeId" value={placeId} /><input type="hidden" name="sourceKey" value={source.key} /><button className={ui.miniBtn} type="submit">Query now</button></form>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {records.length > 0 && (
        <details style={{ marginTop: 12 }}><summary>Stored records ({records.length} most recent)</summary>
          <div className={ui.tableWrap}><table className={ui.table}>
            <thead><tr><th>Record</th><th>Value</th><th>Observed</th><th>Provenance</th></tr></thead>
            <tbody>{records.map(r => (
              <tr key={r.id}>
                <td>{r.title}<span className={ui.sub}>{r.method}{r.revision > 1 ? ` · revision ${r.revision}` : ""}</span></td>
                <td>{r.value ?? "—"} {r.unit}<span className={ui.sub}>{r.uncertainty}</span></td>
                <td>{r.observedStart ? r.observedStart.slice(0, 10) : "No observation date (modelled or undated)"}<span className={ui.sub}>retrieved {r.retrievedAt.slice(0, 10)}</span></td>
                <td>{r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceKey}</a> : r.sourceKey}<span className={ui.sub}>{r.license}{r.precisionM != null ? ` · ±${r.precisionM} m` : ""}{r.sensitive && !owner ? " · location generalised by provider" : ""}{(r.qualityFlags ?? []).length ? ` · flags: ${(r.qualityFlags ?? []).slice(0, 3).join(", ")}` : ""}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      )}
    </section>
  );
}

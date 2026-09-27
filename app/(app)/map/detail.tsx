"use client";

// Selected-item cards: Regenera records and every live-intelligence layer. Values are shown as the source reports
// them, with units and times; missing values say "not reported".
import Link from "next/link";
import { safeWebsite } from "@/lib/map/discovery";
import { SiteContext } from "./atlas-tools";
import styles from "./map.module.css";

export type Selected = { layer: string; props: Record<string, unknown>; lngLat: [number, number] } | null;
type P = Record<string, string | number | boolean | null>;
const nr = (v: unknown, unit = "") => (v == null || v === "" ? "not reported" : `${typeof v === "number" ? v.toLocaleString("en-US") : String(v)}${unit}`);
const ago = (iso: unknown) => {
  if (!iso) return "not reported";
  const m = Math.round((Date.now() - new Date(String(iso)).getTime()) / 60_000);
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

function Facts({ rows }: { rows: [string, string][] }) {
  return <dl className={styles.facts}>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Detail({ selected, onTrack, onChase, tracked }: { selected: NonNullable<Selected>; onTrack: () => void; onChase: () => void; tracked: boolean }) {
  const p = selected.props as P;
  const coords = `${selected.lngLat[1].toFixed(4)}, ${selected.lngLat[0].toFixed(4)}`;
  const trackBtns = (chase: boolean) => (
    <div className={styles.links}>
      <button type="button" className={styles.open} onClick={onTrack} aria-pressed={tracked}>{tracked ? "Tracking" : "Track"}</button>
      {chase && <button type="button" className={styles.open} onClick={onChase}>Chase cam</button>}
    </div>
  );
  switch (selected.layer) {
    case "organizations": return (
      <>
        <p className={styles.kicker}>Organization</p>
        <h3>{p.name}</h3>
        <p className={styles.meta}>{[p.location, p.country].filter(Boolean).join(" · ")}</p>
        {p.sector && <p className={styles.chip}>{String(p.sector).replace(/_/g, " ")}</p>}
        {p.description && <p className={styles.read}>{p.description}</p>}
        {p.topics && <p className={styles.meta}>{String(p.topics).replace(/\|/g, " · ")}</p>}
        <div className={styles.links}>
          <Link className={styles.open} href={`/companies/${p.id}`}>Open record</Link>
          {safeWebsite(p.website) && <a className={styles.open} href={safeWebsite(p.website)!} target="_blank" rel="noreferrer">Website</a>}
        </div>
      </>
    );
    case "projects": return (
      <>
        <p className={styles.kicker}>Project · {String(p.stage).replace(/_/g, " ")}</p>
        <h3>{p.name}</h3>
        <p className={styles.meta}>{[p.capacity ? `${p.capacity} ${p.capacityUnit ?? ""}` : null, p.country].filter(Boolean).join(" · ")}</p>
        {p.description && <p className={styles.read}>{p.description}</p>}
        {p.areaKm2 != null && <p className={styles.meta}>Boundary: {(Number(p.areaKm2) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })} ha</p>}
        <Link className={styles.open} href={`/projects/${p.id}`}>Open project</Link>
        <SiteContext projectId={String(p.id)} />
        <div className={styles.links}>
          <Link className={styles.open} href={`/projects/${p.id}?tab=place`}>Place evidence</Link>
          <Link className={styles.open} href={`/projects/${p.id}?tab=partners`}>Partners</Link>
          <Link className={styles.open} href={`/projects/${p.id}?tab=funding`}>Funding</Link>
        </div>
      </>
    );
    case "deals": return (
      <>
        <p className={styles.kicker}>Opportunity · {String(p.stage).replace(/_/g, " ")}</p>
        <h3>{p.name}</h3>
        <p className={styles.meta}>{p.orgName} · {String(p.engagement).replace(/_/g, " ")}</p>
        <Link className={styles.open} href={`/deals?focus=${p.id}`}>Open opportunity</Link>
      </>
    );
    case "hazards": return (
      <>
        <p className={styles.kicker}>GDACS {p.level} alert</p>
        <h3>{String(p.title).replace(/^(Red|Orange) alert: /, "")}</h3>
        <p className={styles.meta}>{p.country} · {String(p.date).slice(0, 10)}</p>
        {p.url && <a className={styles.open} href={String(p.url)} target="_blank" rel="noreferrer">GDACS report</a>}
      </>
    );
    case "triggers": case "procurement": return (
      <>
        <p className={styles.kicker}>{selected.layer === "procurement" ? (p.source === "funding" ? `Funding · ${p.type} · closes` : "Tender / EOI") : `Trigger · ${p.type}`} · {p.eventDate}</p>
        <h3>{p.summary}</h3>
        <p className={styles.meta}>{p.orgName}{p.relevance != null ? ` · fit ${p.relevance}/100` : ""}{p.urgency != null ? ` · urgency ${p.urgency}/5` : ""}</p>
        {p.decisionRead && <p className={styles.read}>{p.decisionRead}</p>}
        <div className={styles.links}>
          {p.url && <a className={styles.open} href={String(p.url)} target="_blank" rel="noreferrer">Source</a>}
          {p.orgId && <Link className={styles.open} href={`/companies/${p.orgId}`}>Organization</Link>}
          {p.href && <Link className={styles.open} href={String(p.href)}>Open in Funding</Link>}
        </div>
      </>
    );
    case "flights": case "military": return (
      <>
        <p className={styles.kicker}>{p.military ? "Military aircraft" : "Aircraft"} · ADS-B</p>
        <h3>{p.callsign ?? p.reg ?? String(p.id).toUpperCase()}</h3>
        <p className={styles.meta}>{[p.type, p.desc, p.operator].filter(Boolean).join(" · ") || "Type not reported"}</p>
        {p.emergency && <p className={styles.error}>Emergency: {p.emergency}</p>}
        <Facts rows={[["ICAO hex", String(p.id).toUpperCase()], ["Registration", nr(p.reg)], ["Altitude", p.ground ? "on ground" : nr(p.altFt, " ft")], ["Ground speed", nr(p.speedKt, " kt")], ["Track", nr(p.heading, "°")], ["Squawk", nr(p.squawk)]]} />
        {trackBtns(true)}
        <p className={styles.note}>Aircraft data: adsb.lol (ODbL). Community receivers; positions can lag.</p>
      </>
    );
    case "sat_eo": case "sat_weather": case "sat_stations": case "sat_gnss": return (
      <>
        <p className={styles.kicker}>Satellite · computed position</p>
        <h3>{p.name}</h3>
        <Facts rows={[["NORAD", String(p.norad ?? "not reported")], ["Altitude", nr(p.altKm, " km")], ["Speed", nr(p.speedKms, " km/s")]]} />
        {trackBtns(false)}
        <a className={styles.open} href={`https://celestrak.org/satcat/table-satcat.php?CATNR=${p.norad}`} target="_blank" rel="noreferrer">CelesTrak record</a>
        <p className={styles.note}>SGP4 propagation of CelesTrak elements; not an observation.</p>
      </>
    );
    case "quakes": return (
      <>
        <p className={styles.kicker}>Earthquake · USGS</p>
        <h3>M{p.mag} · {p.place}</h3>
        <Facts rows={[["Time", `${String(p.time).slice(0, 16).replace("T", " ")} UTC (${ago(p.time)})`], ["Depth", nr(p.depthKm, " km")], ["PAGER alert", nr(p.alert)], ["Tsunami flag", p.tsunami ? "yes" : "no"]]} />
        <a className={styles.open} href={String(p.url)} target="_blank" rel="noreferrer">USGS event page</a>
      </>
    );
    case "fires": return (
      <>
        <p className={styles.kicker}>Thermal anomaly · NASA FIRMS</p>
        <h3>{nr(p.frp, " MW")} radiative power</h3>
        <Facts rows={[["Acquired", `${nr(p.at)} UTC`], ["Confidence", nr(p.confidence, "/100")]]} />
        <p className={styles.note}>A thermal anomaly is not always a wildfire (flares, industry, agricultural burning).</p>
      </>
    );
    case "events": return (
      <>
        <p className={styles.kicker}>{p.categoryLabel} · NASA EONET</p>
        <h3>{p.title}</h3>
        <Facts rows={[["Latest position", `${String(p.date).slice(0, 16).replace("T", " ")} UTC (${ago(p.date)})`], ["Magnitude", p.magnitude != null ? `${p.magnitude} ${p.magnitudeUnit ?? ""}` : "not reported"], ["Source", nr(p.source)]]} />
        {p.url && <a className={styles.open} href={String(p.url)} target="_blank" rel="noreferrer">Source</a>}
      </>
    );
    case "cyclones": return (
      <>
        <p className={styles.kicker}>{p.classLabel} · NOAA NHC</p>
        <h3>{p.name}</h3>
        <Facts rows={[["Max wind", nr(p.windKt, " kt")], ["Pressure", nr(p.pressureMb, " mb")], ["Movement", p.movementDir != null ? `${p.movementDir}° at ${nr(p.movementKt, " kt")}` : "not reported"], ["Updated", `${String(p.updated ?? "").slice(0, 16).replace("T", " ")} UTC`]]} />
        <a className={styles.open} href={String(p.url)} target="_blank" rel="noreferrer">Public advisory</a>
      </>
    );
    case "power": return (
      <>
        <p className={styles.kicker}>Power infrastructure · OpenStreetMap</p>
        <h3>{p.name ?? "Unnamed"}</h3>
        <Facts rows={Object.entries(p).filter(([k, v]) => v != null && v !== "" && !/^name/.test(k) && k.length < 24).slice(0, 8).map(([k, v]) => [k.replace(/_/g, " "), String(v)])} />
        <p className={styles.note}>Community-mapped via Open Infrastructure Map; verify before relying on it.</p>
      </>
    );
    case "protected": return (
      <>
        <p className={styles.kicker}>Protected area · OpenStreetMap</p>
        <h3>{p["name:en"] ?? p.name ?? "Unnamed"}</h3>
        <p className={styles.meta}>{String(p.class ?? "").replace(/_/g, " ")}</p>
        <p className={styles.note}>OSM mapping is not the legal boundary. Check the WDPA or national registry.</p>
      </>
    );
    default: return (
      <>
        <p className={styles.kicker}>{selected.layer}</p>
        <h3>{String(p.name ?? p.title ?? p.id ?? "Feature")}</h3>
        <p className={styles.coords}>{coords}</p>
      </>
    );
  }
}

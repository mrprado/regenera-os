"use client";

// Street-level view at a point. Loaded only when opened (dynamic import from the map); never on other screens.
// Google Street View (official Maps JavaScript API, browser key restricted by referrer) when configured, else
// Mapillary (open street-level imagery) when a token is set, else a quiet "not connected" status.
import { useEffect, useRef, useState } from "react";
import styles from "./map.module.css";

export type StreetViewConfig = { provider: "google" | "mapillary" | "none"; key: string };
type GoogleNS = { maps: { StreetViewPanorama: new (el: HTMLElement, o: Record<string, unknown>) => unknown; StreetViewService: new () => { getPanorama: (req: Record<string, unknown>, cb: (data: { location?: { latLng?: unknown } } | null, status: string) => void) => void } } };

let googleLoader: Promise<GoogleNS> | null = null;
function loadGoogle(key: string): Promise<GoogleNS> {
  const w = window as unknown as { google?: GoogleNS };
  if (w.google?.maps?.StreetViewPanorama) return Promise.resolve(w.google);
  googleLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__rgStreetView`;
    s.async = true;
    (window as unknown as Record<string, unknown>).__rgStreetView = () => resolve((window as unknown as { google: GoogleNS }).google);
    s.onerror = () => { googleLoader = null; reject(new Error("Google Maps could not load")); };
    document.head.appendChild(s);
  });
  return googleLoader;
}

type Mly = { id: string; thumb_1024_url?: string; captured_at?: number; compass_angle?: number };

export default function StreetView({ lat, lng, config, onClose }: { lat: number; lng: number; config: StreetViewConfig; onClose: () => void }) {
  const pano = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState(config.provider === "none" ? "Street-level imagery is not connected. Add GOOGLE_MAPS_BROWSER_KEY (Street View) or MAPILLARY_TOKEN (free) to enable it." : "Looking for street-level imagery…");
  const [mly, setMly] = useState<Mly[]>([]);

  useEffect(() => {
    let live = true;
    if (config.provider === "google") {
      loadGoogle(config.key).then(g => {
        if (!live || !pano.current) return;
        new g.maps.StreetViewService().getPanorama({ location: { lat, lng }, radius: 80, source: "outdoor" }, (data, st) => {
          if (!live || !pano.current) return;
          if (st !== "OK" || !data?.location?.latLng) { setStatus("Street-level imagery unavailable here."); return; }
          new g.maps.StreetViewPanorama(pano.current, { position: data.location.latLng, pov: { heading: 0, pitch: 0 }, zoom: 0, addressControl: true, motionTracking: false });
          setStatus("");
        });
      }).catch(e => { if (live) setStatus(`${(e as Error).message}.`); });
    } else if (config.provider === "mapillary") {
      const d = 0.0015, bbox = [lng - d, lat - d, lng + d, lat + d].map(x => x.toFixed(6)).join(",");
      fetch(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(config.key)}&fields=id,thumb_1024_url,captured_at,compass_angle&bbox=${bbox}&limit=12`)
        .then(r => r.json() as Promise<{ data?: Mly[] }>)
        .then(j => { if (!live) return; const xs = j.data ?? []; setMly(xs); setStatus(xs.length ? "" : "Street-level imagery unavailable here."); })
        .catch(() => { if (live) setStatus("Mapillary could not be reached."); });
    }
    return () => { live = false; };
  }, [lat, lng, config]);

  return (
    <div className={`${styles.glass} ${styles.streetView}`} role="dialog" aria-label="Street-level view">
      <header><b>Street level</b><span>{lat.toFixed(5)}, {lng.toFixed(5)} · {config.provider === "google" ? "Google Street View" : config.provider === "mapillary" ? "Mapillary (CC BY-SA)" : "not connected"}</span><button type="button" onClick={onClose} aria-label="Close street view">×</button></header>
      {status && <p className={styles.viewsNote} role="status">{status}</p>}
      {config.provider === "google" && <div ref={pano} className={styles.pano} />}
      {config.provider === "mapillary" && mly.length > 0 && <div className={styles.mly}>
        {mly.map(m => <a key={m.id} href={`https://www.mapillary.com/app/?pKey=${m.id}&focus=photo`} target="_blank" rel="noreferrer">
          {m.thumb_1024_url ? <img src={m.thumb_1024_url} alt={`Street photo ${m.captured_at ? new Date(m.captured_at).toISOString().slice(0, 10) : ""}`} loading="lazy" /> : null}
          <small>{m.captured_at ? new Date(m.captured_at).toISOString().slice(0, 10) : ""}{m.compass_angle != null ? ` · facing ${Math.round(m.compass_angle)}°` : ""}</small>
        </a>)}
      </div>}
    </div>
  );
}

// Regional source packs (phase 28C). A pack adds a country's official sources to the register and the rules that apply
// to places there. Mexico is the first pack; the architecture is not specific to it. Statuses verified 2026-10-10.
import * as turf from "@turf/turf";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { stewardPlaces, tasks } from "@/db/schema";
import type { stewardSources } from "@/db/schema";

type Source = Omit<typeof stewardSources.$inferInsert, "updatedAt">;
const V = "2026-10-10";

export const MEXICO_SOURCES: Source[] = [
  { key: "mx_conabio", provider: "CONABIO", name: "CONABIO geoinformation (ecosystems, vegetation, species layers)", region: "MEX", homepage: "https://www.biodiversidad.gob.mx/region/geoinformacion", docsUrl: "http://geoportal.conabio.gob.mx/", accessMethod: "download",
    geographicCoverage: "Mexico", variables: "Ecosystems, land use and vegetation, priority areas, species distributions", licenseName: "Per layer (see metadata)", licenseUrl: "http://geoportal.conabio.gob.mx/",
    commercialUse: "unknown", redistribution: "unknown", aiProcessing: "unknown", attribution: "CONABIO, per layer metadata", auth: "none",
    coverageLimits: "Layer-specific scale and date; distribution models are not confirmed presence.", health: "unverified", enabled: false, verifiedAt: V,
    verificationNote: "Geoportal and download pages reachable 2026-10-10; no documented REST/WFS service confirmed (a guessed GeoServer path returned not found), so none is assumed.",
    blockedReason: "Download per layer after checking its metadata licence; import as a regional extract.", refreshDays: 365 },
  { key: "mx_inpi", provider: "INPI", name: "Atlas and catalogue of Indigenous peoples", region: "MEX", homepage: "https://atlas.inpi.gob.mx/", docsUrl: "https://catalogo.inpi.gob.mx/", accessMethod: "reference",
    geographicCoverage: "Mexico", variables: "Indigenous peoples and localities (published context)", licenseName: "Government publication", commercialUse: "unknown", redistribution: "unknown", aiProcessing: "unknown",
    coverageLimits: "Context only: an atlas entry is not a community's consent, representation or legal boundary. Contacts are never imported into prospecting.", health: "verified", enabled: true, verifiedAt: V,
    verificationNote: "Atlas and catalogue reachable 2026-10-10.", refreshDays: 0 },
  { key: "mx_inegi_indicators", provider: "INEGI", name: "INEGI Banco de Indicadores API", region: "MEX", homepage: "https://www.inegi.org.mx/servicios/api_indicadores.html", docsUrl: "https://www.inegi.org.mx/servicios/api_indicadores.html", accessMethod: "api",
    geographicCoverage: "Mexico (national, state, municipal)", variables: "Demographic and socioeconomic indicators with reporting years", licenseName: "INEGI free use terms", licenseUrl: "https://www.inegi.org.mx/inegi/terminos.html",
    commercialUse: "allowed", redistribution: "conditional", aiProcessing: "allowed", attribution: "INEGI, indicator and reporting year", auth: "key_required",
    coverageLimits: "Population indicators describe areas, never individuals or a specific community.", health: "credential_required", enabled: false, verifiedAt: V,
    verificationNote: "Documentation 2026-10-10: requests need a valid token obtained by registering.", blockedReason: "Needs an INEGI API token (free registration).", refreshDays: 180 },
  { key: "mx_inegi_denue", provider: "INEGI", name: "DENUE establishments API", region: "MEX", homepage: "https://www.inegi.org.mx/servicios/api_denue.html", docsUrl: "https://www.inegi.org.mx/servicios/api_denue.html", accessMethod: "api",
    geographicCoverage: "Mexico", variables: "Economic establishments near a point (local economy context)", licenseName: "INEGI free use terms", licenseUrl: "https://www.inegi.org.mx/inegi/terminos.html",
    commercialUse: "allowed", redistribution: "conditional", aiProcessing: "allowed", attribution: "INEGI DENUE", auth: "key_required", coverageLimits: "Registered establishments only; informal activity is not captured.",
    health: "credential_required", enabled: false, verifiedAt: V, verificationNote: "Documentation 2026-10-10: token required.", blockedReason: "Needs an INEGI API token (free registration).", refreshDays: 180 },
  { key: "mx_conagua", provider: "CONAGUA", name: "CONAGUA water information systems", region: "MEX", homepage: "https://app.conagua.gob.mx/sistemasdeagua/", accessMethod: "manual",
    geographicCoverage: "Mexico", variables: "Hydrometric and climate stations, water quality, aquifer availability (per system)", licenseName: "Government publication", commercialUse: "unknown", redistribution: "unknown", aiProcessing: "unknown",
    coverageLimits: "Station data with gaps; no unified API exists. Track station, date, variable, unit and method for every value.", health: "unavailable", enabled: false, verifiedAt: V,
    verificationNote: "The systems page redirected to itself on 2026-10-10 (needs a browser session); no automated access.", blockedReason: "Import published station or aquifer data manually with its station, period and method.", refreshDays: 90 },
  { key: "mx_ran", provider: "Registro Agrario Nacional", name: "RAN agrarian information", region: "MEX", homepage: "https://www.gob.mx/ran/", accessMethod: "reference",
    geographicCoverage: "Mexico", variables: "Ejidos and agrarian communities (public information)", licenseName: "Government publication", commercialUse: "unknown", redistribution: "unknown", aiProcessing: "unknown",
    coverageLimits: "Mapped agrarian context is not current title, access rights or legal due diligence.", health: "unavailable", enabled: false, verifiedAt: V,
    verificationNote: "The site served a bot challenge on 2026-10-10; not bypassed.", blockedReason: "Use documents obtained through the RAN or the community's counsel; link them as evidence.", refreshDays: 0 },
  { key: "mx_inah", provider: "INAH", name: "INAH heritage catalogues", region: "MEX", homepage: "https://www.catalogonacionalmhi.inah.gob.mx/consultaPublica", docsUrl: "https://patrimoniomundialmexico.inah.gob.mx/", accessMethod: "reference",
    geographicCoverage: "Mexico", variables: "Registered historic monuments and World Heritage context", licenseName: "Government publication", commercialUse: "unknown", redistribution: "unknown", aiProcessing: "prohibited",
    coverageLimits: "Sensitive archaeological locations are never extracted or published; an unlisted place is not without cultural significance.", health: "verified", enabled: true, verifiedAt: V,
    verificationNote: "Public catalogues reachable 2026-10-10; used as reference only.", refreshDays: 0 },
];

/** Approximate Yucatán peninsula (Campeche, Yucatán, Quintana Roo): karst, groundwater-dominated hydrology. */
const YUCATAN = { w: -92.6, s: 17.75, e: -86.5, n: 21.75 };
export type Advisory = { key: string; title: string; text: string; taskTitle?: string };

/** Rules for a place from the packs that cover it. Pure: geometry centroid and country only. */
export function regionalAdvisories(place: { country: string | null; geometry: Record<string, unknown> | null }, centroid: [number, number] | null): Advisory[] {
  const out: Advisory[] = [];
  const mx = (place.country ?? "").toUpperCase().startsWith("MEX") || (place.country ?? "").toLowerCase() === "mexico" || place.country === "MX";
  if (centroid && centroid[0] >= YUCATAN.w && centroid[0] <= YUCATAN.e && centroid[1] >= YUCATAN.s && centroid[1] <= YUCATAN.n && (mx || !place.country)) {
    out.push({ key: "mx_karst", title: "Karst groundwater (Yucatán peninsula)",
      text: "Water moves underground through karst (cenotes, conduits); surface-water and watershed datasets cannot show these pathways or groundwater quality. Water conclusions need local hydrogeological evidence.",
      taskTitle: "Request local hydrogeological evidence (karst)" });
  }
  if (mx) out.push({ key: "mx_rights", title: "Agrarian and Indigenous context (Mexico)", text: "Ejido and community land, and Indigenous peoples' context, need documents from the RAN and engagement with the community's own institutions; atlas entries do not establish consent, representation or boundaries." });
  return out;
}


export const centroidOf = (g: Record<string, unknown> | null): [number, number] | null => {
  if (!g) return null;
  try { const c = turf.centroid(turf.feature(g as never)).geometry.coordinates; return [c[0], c[1]]; } catch { return null; }
};

/** Creates one task per place and advisory that asks for evidence (e.g. karst hydrogeology); never twice. */
export async function ensureAdvisoryTasks(db: Db, now = new Date()) {
  let created = 0;
  for (const p of await db.select().from(stewardPlaces)) {
    for (const a of regionalAdvisories(p, centroidOf(p.geometry)).filter(x => x.taskTitle)) {
      const workstream = `steward:${p.id}:${a.key}`;
      const [exists] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.workstream, workstream)).limit(1);
      if (exists) continue;
      await db.insert(tasks).values({ mandateId: p.mandateId, type: "other", title: `${a.taskTitle}: ${p.name}`, body: `${a.text} Place: /steward/places/${p.id}`, dueAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(), owner: p.responsible, workstream });
      created++;
    }
  }
  return created;
}

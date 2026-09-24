// Recipient-local send windows (docs/plans/phase-2.md defaults). DST-aware via Intl time zones.

export type Window = { from: string; to: string }; // "HH:MM" local
export type WeekWindows = Record<number, Window[]>; // 0=Sun..6=Sat

export const DEFAULT_WINDOWS: WeekWindows = {
  1: [{ from: "09:30", to: "11:30" }],
  2: [{ from: "08:30", to: "11:30" }, { from: "14:00", to: "16:30" }],
  3: [{ from: "08:30", to: "11:30" }, { from: "14:00", to: "16:30" }],
  4: [{ from: "08:30", to: "11:30" }, { from: "14:00", to: "16:30" }],
  5: [{ from: "09:30", to: "11:30" }],
};

// Primary time zone per country (ISO2 or common name). Countries with several zones use the business capital.
const COUNTRY_TZ: Record<string, string> = {
  US: "America/New_York", "UNITED STATES": "America/New_York", USA: "America/New_York", CA: "America/Toronto", CANADA: "America/Toronto",
  MX: "America/Mexico_City", MEXICO: "America/Mexico_City", GT: "America/Guatemala", CR: "America/Costa_Rica", PA: "America/Panama",
  CO: "America/Bogota", COLOMBIA: "America/Bogota", PE: "America/Lima", PERU: "America/Lima", EC: "America/Guayaquil", CL: "America/Santiago", CHILE: "America/Santiago",
  AR: "America/Argentina/Buenos_Aires", ARGENTINA: "America/Argentina/Buenos_Aires", BR: "America/Sao_Paulo", BRAZIL: "America/Sao_Paulo", UY: "America/Montevideo", PY: "America/Asuncion", BO: "America/La_Paz",
  DO: "America/Santo_Domingo", JM: "America/Jamaica", PR: "America/Puerto_Rico",
  GB: "Europe/London", UK: "Europe/London", "UNITED KINGDOM": "Europe/London", IE: "Europe/Dublin", PT: "Europe/Lisbon", ES: "Europe/Madrid", SPAIN: "Europe/Madrid",
  FR: "Europe/Paris", FRANCE: "Europe/Paris", BE: "Europe/Brussels", NL: "Europe/Amsterdam", DE: "Europe/Berlin", GERMANY: "Europe/Berlin", CH: "Europe/Zurich",
  IT: "Europe/Rome", AT: "Europe/Vienna", DK: "Europe/Copenhagen", SE: "Europe/Stockholm", NO: "Europe/Oslo", FI: "Europe/Helsinki", PL: "Europe/Warsaw",
  GR: "Europe/Athens", TR: "Europe/Istanbul", LU: "Europe/Luxembourg",
  AE: "Asia/Dubai", "UNITED ARAB EMIRATES": "Asia/Dubai", SA: "Asia/Riyadh", "SAUDI ARABIA": "Asia/Riyadh", QA: "Asia/Qatar", OM: "Asia/Muscat", BH: "Asia/Bahrain", KW: "Asia/Kuwait",
  EG: "Africa/Cairo", MA: "Africa/Casablanca", NG: "Africa/Lagos", GH: "Africa/Accra", KE: "Africa/Nairobi", ZA: "Africa/Johannesburg", "SOUTH AFRICA": "Africa/Johannesburg",
  IN: "Asia/Kolkata", INDIA: "Asia/Kolkata", SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", ID: "Asia/Jakarta", PH: "Asia/Manila", VN: "Asia/Ho_Chi_Minh", TH: "Asia/Bangkok",
  CN: "Asia/Shanghai", HK: "Asia/Hong_Kong", JP: "Asia/Tokyo", KR: "Asia/Seoul", AU: "Australia/Sydney", AUSTRALIA: "Australia/Sydney", NZ: "Pacific/Auckland",
};

export function timeZoneFor(contact: { timezone?: string | null; country?: string | null }): string {
  if (contact.timezone && isValidZone(contact.timezone)) return contact.timezone;
  const c = contact.country?.trim().toUpperCase();
  return (c && COUNTRY_TZ[c]) || "America/New_York";
}

function isValidZone(tz: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

function localParts(date: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function inWindow(date: Date, tz: string, windows: WeekWindows = DEFAULT_WINDOWS): boolean {
  const { weekday, minutes } = localParts(date, tz);
  return (windows[weekday] ?? []).some(w => minutes >= toMin(w.from) && minutes < toMin(w.to));
}

/** The next instant (5-minute resolution, within 8 days) that falls inside a window. */
export function nextWindowStart(after: Date, tz: string, windows: WeekWindows = DEFAULT_WINDOWS): Date {
  const step = 5 * 60_000;
  let t = new Date(Math.ceil(after.getTime() / step) * step);
  for (let i = 0; i < (8 * 24 * 60) / 5; i++) {
    if (inWindow(t, tz, windows)) return t;
    t = new Date(t.getTime() + step);
  }
  return after;
}

/** Warm-up daily cap: 10 on day 1, +3 per day, up to the ceiling. */
export function warmupCap(warmupStartedOn: string | null, today: Date, ceiling: number, start = 10, stepPerDay = 3): number {
  if (!warmupStartedOn) return ceiling;
  const days = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.parse(`${warmupStartedOn}T00:00:00Z`)) / 86_400_000);
  return Math.min(ceiling, start + Math.max(0, days) * stepPerDay);
}

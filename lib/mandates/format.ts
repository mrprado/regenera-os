// Display helpers for mandate screens (pages export only default).
export const money = (v: number | null | undefined, cur = "USD") => (v == null ? "—" : `${cur === "USD" ? "$" : `${cur} `}${Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(v % 1e3 ? 1 : 0)}k` : Math.round(v).toString()}`);
export const day = (s?: string | null) => (s ? s.slice(0, 10) : "—");
export const label = (s?: string | null) => (s ?? "").replace(/_/g, " ");
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
/** ISO timestamp 14 days ago: the stalled-pursuit threshold. */
export const staleCutoff = (days = 14) => new Date(Date.now() - days * 864e5).toISOString();

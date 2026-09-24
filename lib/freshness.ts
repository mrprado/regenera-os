// Current-data policy (Prado, Sep 23, 2026): events, news, tenders and filings are only used when
// they are current. Identity facts read today (website, legal entity, HQ) are current by definition.

/** Events before this date are ignored everywhere: the start of the current calendar year. */
export function freshnessSince(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

/** Per-signal windows, never earlier than freshnessSince(). */
export const WINDOWS_DAYS = {
  news: 45,          // news and appointments
  filing: 120,       // SEC Form D and similar filings
  procurement: 60,   // tender publication; also requires an open deadline
  hazard: 14,        // GDACS alerts
} as const;

export function windowStart(kind: keyof typeof WINDOWS_DAYS, now = new Date()): Date {
  const rolling = new Date(now.getTime() - WINDOWS_DAYS[kind] * 86_400_000);
  const floor = freshnessSince(now);
  return rolling > floor ? rolling : floor;
}

/** True when an event date is inside the window. Undated events are not current. */
export function isCurrent(eventDate: string | Date | null | undefined, kind: keyof typeof WINDOWS_DAYS, now = new Date()): boolean {
  if (!eventDate) return false;
  const d = typeof eventDate === "string" ? new Date(eventDate) : eventDate;
  if (Number.isNaN(d.getTime())) return false;
  return d >= windowStart(kind, now) && d.getTime() <= now.getTime() + 86_400_000;
}

/** Tenders are only useful while they can still be answered. */
export function isOpenDeadline(deadline: string | null | undefined, now = new Date()): boolean {
  if (!deadline) return true; // some notices omit it; publication date still has to be current
  const d = new Date(deadline);
  return !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime();
}

/** YYYYMMDD for APIs that want compact dates. */
export const compactDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

// Workspace-time helpers (named ET for history; now Pacific, see lib/time/zone.ts). Schedules are defined in this zone and evaluated here, DST-aware.
import { WORKSPACE_TZ } from "./zone";
export const ET = WORKSPACE_TZ;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  weekday: "short",
});

export type EtParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function etParts(date: Date): EtParts {
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map(x => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** Offset of the workspace zone from UTC at the given instant, in ms (e.g. -7h in PDT). */
function etOffsetMs(instantMs: number): number {
  const p = etParts(new Date(instantMs));
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The UTC instant of an ET wall-clock time. Month is 1-based; day may overflow (normalized by Date.UTC). */
export function etToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - etOffsetMs(wall);
  // Re-evaluate once in case the first guess crossed a DST boundary.
  const corrected = wall - etOffsetMs(instant);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

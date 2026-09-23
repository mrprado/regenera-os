import { etParts, etToUtc } from "./et";

// Cadence grammar (all wall-clock times in ET):
//   every:<n>m | every:<n>h          fixed interval from now
//   daily:HH:MM                      every day
//   weekly:<sun..sat>:HH:MM          one weekday
//   monthly:<1-28>:HH:MM             one day of month
export type Cadence =
  | { kind: "every"; ms: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "monthly"; day: number; hour: number; minute: number };

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const EVERY = /^every:(\d+)([mh])$/;
const DAILY = /^daily:(\d{2}):(\d{2})$/;
const WEEKLY = /^weekly:(sun|mon|tue|wed|thu|fri|sat):(\d{2}):(\d{2})$/;
const MONTHLY = /^monthly:(\d{1,2}):(\d{2}):(\d{2})$/;

function hm(h: string, m: string) {
  const hour = Number(h), minute = Number(m);
  if (hour > 23 || minute > 59) throw new Error("Invalid time in cadence");
  return { hour, minute };
}

export function parseCadence(value: string): Cadence {
  let m = EVERY.exec(value);
  if (m) {
    const n = Number(m[1]);
    if (n < 1) throw new Error("Interval must be positive");
    return { kind: "every", ms: n * (m[2] === "h" ? 3_600_000 : 60_000) };
  }
  if ((m = DAILY.exec(value))) return { kind: "daily", ...hm(m[1], m[2]) };
  if ((m = WEEKLY.exec(value))) return { kind: "weekly", weekday: DAYS.indexOf(m[1]), ...hm(m[2], m[3]) };
  if ((m = MONTHLY.exec(value))) {
    const day = Number(m[1]);
    if (day < 1 || day > 28) throw new Error("Monthly day must be 1-28");
    return { kind: "monthly", day, ...hm(m[2], m[3]) };
  }
  throw new Error(`Unrecognized cadence: ${value}`);
}

/** Next run strictly after `from`. */
export function nextRun(cadence: string | Cadence, from: Date): Date {
  const c = typeof cadence === "string" ? parseCadence(cadence) : cadence;
  if (c.kind === "every") return new Date(from.getTime() + c.ms);

  const p = etParts(from);
  if (c.kind === "monthly") {
    for (let i = 0; i < 3; i++) {
      const candidate = etToUtc(p.year, p.month + i, c.day, c.hour, c.minute);
      if (candidate > from) return candidate;
    }
    throw new Error("unreachable");
  }
  for (let i = 0; i <= 8; i++) {
    const candidate = etToUtc(p.year, p.month, p.day + i, c.hour, c.minute);
    if (candidate <= from) continue;
    if (c.kind === "weekly" && etParts(candidate).weekday !== c.weekday) continue;
    return candidate;
  }
  throw new Error("unreachable");
}

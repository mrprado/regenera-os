// The workspace time zone: California. Schedules, the daily send cap, and "today" on Command and Tasks all use it.
// Contact send windows use each contact's own zone (lib/time/windows.ts).
export const WORKSPACE_TZ = "America/Los_Angeles";

/** An ISO instant as workspace wall-clock time with its zone abbreviation, for display ("Oct 2, 14:05 PDT"). Storage stays UTC. */
export function fmtLocal(iso: string | null | undefined, tz = WORKSPACE_TZ): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(d);
}

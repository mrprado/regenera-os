import type { scanResults, scanRuns } from "@/db/scans";

export type ReviewParams = Record<string, string | undefined>;
type Result = typeof scanResults.$inferSelect;
type Run = typeof scanRuns.$inferSelect;
const matchOrder = ["matches", "partial", "unknown", "excluded"];
const compare = (a: string | number, b: string | number) => typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en", { sensitivity: "base", numeric: true });
const date = (value?: string) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
const within = (value: string, sp: ReviewParams) => (!date(sp.from) || value.slice(0, 10) >= date(sp.from)) && (!date(sp.to) || value.slice(0, 10) <= date(sp.to));
const includes = (values: string[], q?: string) => !q?.trim() || values.join(" ").toLocaleLowerCase().includes(q.trim().toLocaleLowerCase());

export function filterResults(rows: Result[], sp: ReviewParams): Result[] {
  const sort = ["name", "match", "retrievedAt", "outcome", "review", "provider", "missing"].includes(sp.sort ?? "") ? sp.sort! : "match";
  const direction = sp.direction === "desc" ? -1 : 1;
  return rows.filter(x => includes([x.name, x.provider, x.exclusionReason ?? ""], sp.q)
    && (!sp.match || x.match === sp.match)
    && (!sp.outcome || x.outcome === sp.outcome)
    && (!sp.review || x.review === sp.review)
    && (!sp.provider || x.provider === sp.provider)
    && within(x.retrievedAt, sp)).sort((a, b) => {
      const value = (x: Result) => sort === "match" ? matchOrder.indexOf(x.match) : sort === "missing" ? x.missing.length : x[sort as "name" | "retrievedAt" | "outcome" | "review" | "provider"];
      return direction * compare(value(a), value(b)) || compare(a.name, b.name) || compare(a.id, b.id);
    });
}

export function filterRuns(rows: Run[], sp: ReviewParams): Run[] {
  const sort = ["started", "name", "status", "found", "new", "matching", "needsReview", "credits"].includes(sp.sort ?? "") ? sp.sort! : "started";
  const direction = sp.direction === "asc" ? 1 : -1;
  return rows.filter(x => includes([x.presetName, x.audience, x.requestedBy], sp.q)
    && (!sp.status || x.status === sp.status)
    && (!sp.runSection || x.section === sp.runSection)
    && (!sp.provider || x.providers.some(p => p.provider === sp.provider))
    && within(x.startedAt ?? x.createdAt, sp)).sort((a, b) => {
      const value = (x: Run): string | number => sort === "started" ? x.startedAt ?? x.createdAt : sort === "name" ? x.presetName : sort === "status" ? x.status : sort === "credits" ? x.creditsUsed : x.counts[sort as "found" | "new" | "matching" | "needsReview"] ?? 0;
      return direction * compare(value(a), value(b)) || compare(a.id, b.id);
    });
}

export function pageOf<T>(rows: T[], page?: string, size = 50) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const requested = Number(page);
  const current = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pages) : 1;
  return { rows: rows.slice((current - 1) * size, current * size), current, pages };
}

export function reviewHref(path: string, sp: ReviewParams, changes: ReviewParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...sp, ...changes })) if (value && key !== "notice") query.set(key, value);
  return `${path}${query.size ? `?${query}` : ""}`;
}

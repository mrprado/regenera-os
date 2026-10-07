import Link from "next/link";
import { SCAN_PROVIDERS, SCAN_SECTIONS, SCAN_STATUS_LABEL } from "@/lib/scan/config";
import { reviewHref, type ReviewParams } from "@/lib/scan/review-filters";
import s from "./scans.module.css";

const matches = { matches: "Matches criteria", partial: "Partial match", unknown: "Not enough evidence", excluded: "Excluded" };
const outcomes = { new: "New record", existing: "Already in workspace", duplicate: "Duplicate", excluded: "Excluded" };
const reviews = { needs_review: "Needs review", accepted: "Accepted", rejected: "Rejected" };

export function ReviewControls({ path, sp, kind, total, filtered, providers }: { path: string; sp: ReviewParams; kind: "runs" | "results"; total: number; filtered: number; providers: string[] }) {
  const result = kind === "results";
  const options = result ? { match: "Match category", name: "Name", retrievedAt: "Retrieved date", outcome: "Record outcome", review: "Review status", provider: "Source", missing: "Unknown facts" } : { started: "Started date", name: "Scan name", status: "Run status", found: "Found", new: "New records", matching: "Matches", needsReview: "To review", credits: "Credits used" };
  const select = (name: string, label: string, values: Record<string, string>) => <label>{label}<select name={name} defaultValue={sp[name] ?? ""}><option value="">All</option>{Object.entries(values).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
  return <section className={s.filterSection} aria-label="Filters and sorting">
    <h2 className={s.h2}>Filters and sorting</h2>
    <form method="get" action={path} className={s.filters}>
      {sp.tab && <input type="hidden" name="tab" value={sp.tab} />}
      <label>Search<input name="q" defaultValue={sp.q ?? ""} placeholder={result ? "Name or source" : "Scan name or requester"} /></label>
      {result ? <>{select("match", "Match", matches)}{select("outcome", "Record outcome", outcomes)}{select("review", "Review status", reviews)}</> : <>{select("status", "Run status", SCAN_STATUS_LABEL)}{select("runSection", "Section", SCAN_SECTIONS)}</>}
      {select("provider", "Source", Object.fromEntries(providers.map(p => [p, SCAN_PROVIDERS[p as keyof typeof SCAN_PROVIDERS]?.label ?? p])))}
      <label>From date<input type="date" name="from" defaultValue={sp.from ?? ""} /></label>
      <label>To date<input type="date" name="to" defaultValue={sp.to ?? ""} /></label>
      <label>Sort by<select name="sort" defaultValue={sp.sort && sp.sort in options ? sp.sort : result ? "match" : "started"}>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <label>Order<select name="direction" defaultValue={sp.direction === "asc" || sp.direction === "desc" ? sp.direction : result ? "asc" : "desc"}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <div className={s.filterActions}><button className="btn" type="submit">Apply filters</button><Link href={reviewHref(path, { tab: sp.tab })}>Clear filters</Link></div>
    </form>
    <p>{filtered} of {total} {result ? "results in this view" : "scans"} · dates use UTC · filters apply before pagination</p>
  </section>;
}

export function ReviewPagination({ path, sp, current, pages }: { path: string; sp: ReviewParams; current: number; pages: number }) {
  if (pages <= 1) return null;
  return <nav className={s.filterActions} aria-label="Result pages">{current > 1 && <Link href={reviewHref(path, sp, { page: String(current - 1) })}>Previous</Link>}<span>Page {current} of {pages}</span>{current < pages && <Link href={reviewHref(path, sp, { page: String(current + 1) })}>Next</Link>}</nav>;
}

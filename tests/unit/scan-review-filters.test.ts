import { describe, expect, it } from "vitest";
import type { scanResults, scanRuns } from "@/db/scans";
import { filterResults, filterRuns, pageOf, reviewHref } from "@/lib/scan/review-filters";

type Result = typeof scanResults.$inferSelect;
type Run = typeof scanRuns.$inferSelect;
const result = (id: string, values: Partial<Result> = {}): Result => ({ id, name: id, match: "partial", outcome: "new", review: "needs_review", provider: "web", retrievedAt: "2026-10-02T12:00:00Z", missing: [], ...values } as Result);
const run = (id: string, values: Partial<Run> = {}): Run => ({ id, presetName: id, audience: "energy", requestedBy: "reviewer", section: "prospecting", status: "completed", createdAt: "2026-10-02T12:00:00Z", startedAt: null, counts: {}, providers: [], creditsUsed: 0, ...values } as Run);

describe("scan outcome review", () => {
  it("combines match, record outcome, review, provider and inclusive dates", () => {
    const rows = [result("A", { match: "matches" }), result("B", { match: "matches", review: "accepted" }), result("C", { match: "matches", provider: "gleif" }), result("D", { match: "matches", retrievedAt: "2026-10-01T23:59:59Z" })];
    expect(filterResults(rows, { match: "matches", outcome: "new", review: "needs_review", provider: "web", from: "2026-10-02", to: "2026-10-02" }).map(x => x.id)).toEqual(["A"]);
  });
  it("sorts numeric unknown counts both ways without mutating original rows", () => {
    const rows = [result("A", { missing: Array(10).fill("unknown") }), result("B", { missing: ["unknown"] })];
    expect(filterResults(rows, { sort: "missing", direction: "asc" }).map(x => x.id)).toEqual(["B", "A"]);
    expect(filterResults(rows, { sort: "missing", direction: "desc" }).map(x => x.id)).toEqual(["A", "B"]);
    expect(rows.map(x => x.id)).toEqual(["A", "B"]);
  });
  it("finds a match beyond the former 600-row limit before paginating", () => {
    const rows = Array.from({ length: 650 }, (_, i) => result(String(i), { review: i === 649 ? "accepted" : "needs_review" }));
    expect(pageOf(filterResults(rows, { review: "accepted" })).rows.map(x => x.id)).toEqual(["649"]);
  });
  it("defaults to categorical match ordering and stable name ties", () => {
    expect(filterResults([result("Z"), result("A"), result("M", { match: "matches" })], { sort: "invalid" }).map(x => x.id)).toEqual(["M", "A", "Z"]);
  });
  it("filters history by section/status/provider and sorts counts numerically", () => {
    const rows = [run("A", { counts: { new: 10 } as Run["counts"], providers: [{ provider: "web", status: "ok", detail: "" }] }), run("B", { counts: { new: 2 } as Run["counts"], providers: [{ provider: "web", status: "ok", detail: "" }] }), run("C", { section: "capital" })];
    expect(filterRuns(rows, { runSection: "prospecting", status: "completed", provider: "web", sort: "new", direction: "asc" }).map(x => x.id)).toEqual(["B", "A"]);
  });
  it("clamps pages and preserves filters in links without notices", () => {
    expect(pageOf([1, 2, 3], "999", 2)).toEqual({ rows: [3], current: 2, pages: 2 });
    expect(pageOf([1], "-1").current).toBe(1);
    expect(reviewHref("/scans", { tab: "runs", q: "solar & storage", page: "2", notice: "old" }, { page: "3" })).toBe("/scans?tab=runs&q=solar+%26+storage&page=3");
  });
});

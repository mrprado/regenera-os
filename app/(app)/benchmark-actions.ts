"use server";

// Technology library and cost benchmarks: manual entry, CSV import (formula-safe parsing), and contributing a
// project's own figures back as a Regenera benchmark (the project → benchmark feedback loop).
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { costBenchmarks, projects, technologies } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withOsUser } from "@/lib/auth";
import { projectMetrics } from "@/lib/benchmarks/engine";
import { BENCH_CONFIDENCE, MATURITY, METRICS, PRICE_BASIS, SOURCE_QUALITY, TECH_CATEGORIES } from "@/lib/benchmarks/vocab";
import { appDb, mandateCondition } from "@/lib/db/scoped";

const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const str = (f: FormData, k: string, max = 600) => z.string().trim().max(max).catch("").parse(f.get(k) ?? "");
const num = (v: string) => { const s = v.replace(/[^0-9.\-]/g, ""); const n = Number(s); return s && Number.isFinite(n) ? n : null; };
const note = (path: string, text: string) => `${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(text)}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);

export async function addTechnologyAction(formData: FormData) {
  let msg = "Technology added.";
  await withOsUser(async user => {
    const name = str(formData, "name", 160);
    if (!name) { msg = "Name required."; return; }
    const key = slug(str(formData, "key", 60) || name);
    const lines = (k: string) => str(formData, k, 600).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    try {
      await appDb().insert(technologies).values({ mandateId: user.scope.mandateIds[0], key, name, category: z.enum(keys(TECH_CATEGORIES)).parse(formData.get("category")), description: str(formData, "description", 2000), maturity: z.enum(keys(MATURITY)).catch("mature").parse(formData.get("maturity")), trl: num(str(formData, "trl", 2)), typicalScale: str(formData, "typicalScale", 200), usefulLifeYears: num(str(formData, "usefulLifeYears", 6)), efficiency: str(formData, "efficiency", 200), inputs: lines("inputs"), outputs: lines("outputs"), waterIntensity: str(formData, "waterIntensity", 200), landIntensity: str(formData, "landIntensity", 200), energyIntensity: str(formData, "energyIntensity", 200), technicalRisks: str(formData, "technicalRisks", 1000), financingAvailability: str(formData, "financingAvailability", 600), geographicConstraints: str(formData, "geographicConstraints", 600), suppliers: str(formData, "suppliers", 600), source: str(formData, "source", 400), createdBy: user.email });
      await audit(appDb(), { actor: user.email, action: "technology.create", entity: "technology", entityId: key });
    } catch { msg = `A technology with key "${key}" already exists.`; }
  });
  redirect(note("/benchmarks?tab=technologies", msg));
}

type Row = typeof costBenchmarks.$inferInsert;
function validate(r: Partial<Row>): string | null {
  if (!r.technology) return "technology missing";
  if (!r.metric || !METRICS[r.metric]) return `unknown metric "${r.metric ?? ""}"`;
  if (r.value === null || r.value === undefined || !Number.isFinite(r.value)) return "value missing";
  if (!r.source) return "source missing (every benchmark needs provenance)";
  if (METRICS[r.metric].kind.startsWith("money") && !r.currency) return "money metric without currency";
  return null;
}

export async function addBenchmarkAction(formData: FormData) {
  let msg = "Benchmark recorded.";
  await withOsUser(async user => {
    const row: Row = {
      mandateId: user.scope.mandateIds[0], technology: slug(str(formData, "technology", 60)), metric: str(formData, "metric", 60), value: num(str(formData, "value", 30)) as number,
      currency: str(formData, "currency", 3).toUpperCase() || null, baseYear: num(str(formData, "baseYear", 4)), priceBasis: z.enum(keys(PRICE_BASIS)).catch("nominal").parse(formData.get("priceBasis")),
      country: str(formData, "country", 60).toUpperCase() || null, region: str(formData, "region", 80), scaleValue: num(str(formData, "scaleValue", 20)), scaleUnit: str(formData, "scaleUnit", 20),
      project: str(formData, "project", 200), included: str(formData, "included", 600), excluded: str(formData, "excluded", 600), source: str(formData, "source", 400), sourceUrl: str(formData, "sourceUrl", 500) || null,
      sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null).parse(formData.get("sourceDate") || null), sourceQuality: z.enum(keys(SOURCE_QUALITY)).catch("secondary").parse(formData.get("sourceQuality")),
      confidence: z.enum(keys(BENCH_CONFIDENCE)).catch("moderate").parse(formData.get("confidence")), notes: str(formData, "notes", 1000), createdBy: user.email,
    };
    const why = validate(row);
    if (why) { msg = `Not recorded: ${why}.`; return; }
    await appDb().insert(costBenchmarks).values(row);
  });
  redirect(note("/benchmarks?tab=benchmarks", msg));
}

/** CSV import. Header row names the columns; cells are read as plain text (never evaluated). Bad rows are reported, not guessed. */
export async function importBenchmarksAction(formData: FormData) {
  let msg = "";
  await withOsUser(async user => {
    const text = str(formData, "csv", 200_000);
    const parse = (line: string) => { const out: string[] = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(c => c.trim().replace(/^[=+\-@]+(?=\D)/, "")); };
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { msg = "Paste a header row and at least one data row."; return; }
    const head = parse(lines[0]).map(h => h.toLowerCase());
    const col = (cells: string[], name: string) => { const i = head.indexOf(name); return i >= 0 ? cells[i] ?? "" : ""; };
    const good: Row[] = []; const bad: string[] = [];
    lines.slice(1, 2001).forEach((l, i) => {
      const c = parse(l);
      const row: Row = {
        mandateId: user.scope.mandateIds[0], technology: slug(col(c, "technology")), metric: col(c, "metric"), value: num(col(c, "value")) as number, currency: col(c, "currency").toUpperCase() || null,
        baseYear: num(col(c, "base_year")), priceBasis: col(c, "price_basis") === "real" ? "real" : "nominal", country: col(c, "country").toUpperCase() || null, region: col(c, "region"), scaleValue: num(col(c, "scale_value")),
        scaleUnit: col(c, "scale_unit"), project: col(c, "project"), included: col(c, "included"), excluded: col(c, "excluded"), source: col(c, "source"), sourceUrl: col(c, "source_url") || null,
        sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(col(c, "source_date")) ? col(c, "source_date") : null, sourceQuality: (col(c, "source_quality") in SOURCE_QUALITY ? col(c, "source_quality") : "secondary") as Row["sourceQuality"],
        confidence: (col(c, "confidence") in BENCH_CONFIDENCE ? col(c, "confidence") : "moderate") as Row["confidence"], notes: col(c, "notes"), createdBy: user.email,
      };
      const why = validate(row);
      if (why) bad.push(`row ${i + 2}: ${why}`); else good.push(row);
    });
    for (let i = 0; i < good.length; i += 5) await appDb().insert(costBenchmarks).values(good.slice(i, i + 5));
    await audit(appDb(), { actor: user.email, action: "benchmarks.import", entity: "cost_benchmarks", after: { imported: good.length, rejected: bad.length } });
    msg = `Imported ${good.length} benchmark(s).${bad.length ? ` Rejected ${bad.length}: ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? "…" : ""}` : ""}`;
  });
  redirect(note("/benchmarks?tab=benchmarks", msg));
}

/** Feedback loop: a project's own figure becomes a Regenera benchmark (source = the project record, with its stage). */
export async function contributeProjectAction(formData: FormData) {
  const projectId = z.string().uuid().parse(formData.get("projectId"));
  const metric = str(formData, "metric", 60), from = str(formData, "from", 200);
  let msg = "Added to benchmarks.";
  await withOsUser(async user => {
    const [p] = await appDb().select().from(projects).where(and(eq(projects.id, projectId), mandateCondition(user.scope, projects.mandateId)));
    if (!p) throw new Error("Project not found");
    const m = (await projectMetrics(appDb(), projectId)).find(x => x.metric === metric && x.from === from);
    if (!m) { msg = "That figure is no longer on the project."; return; }
    const existing = await appDb().select({ id: costBenchmarks.id }).from(costBenchmarks).where(and(eq(costBenchmarks.projectId, projectId), eq(costBenchmarks.metric, metric)));
    for (const e of existing) await appDb().update(costBenchmarks).set({ deletedAt: new Date().toISOString() }).where(eq(costBenchmarks.id, e.id));
    await appDb().insert(costBenchmarks).values({ mandateId: p.mandateId, technology: m.technology, metric, value: m.value, currency: m.currency, baseYear: new Date().getUTCFullYear(), country: p.country, scaleValue: m.scaleValue, scaleUnit: metric.includes("kwh") ? "MWh" : "MW", project: p.name, projectId, source: `Regenera project record: ${m.from} (stage ${p.stage})`, sourceQuality: "regenera", confidence: ["construction", "commissioning", "cod", "operations"].includes(p.stage) ? "high" : "low", notes: p.name.startsWith("DEMO") ? "DEMO data" : "", createdBy: user.email });
    await audit(appDb(), { actor: user.email, action: "benchmarks.contribute", entity: "project", entityId: projectId, after: { metric, value: m.value } });
  });
  redirect(note(`/projects/${projectId}?tab=benchmarks`, msg));
}

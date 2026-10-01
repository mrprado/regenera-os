// Backfill CLI for Gmail historical intelligence (docs/plans/phase-13-mail-intelligence.md).
//   node scripts/mail-import.mjs <import-dir> [--base http://localhost:5180/os] [--from-start]
// <import-dir>/manifest.json  { account, mandateId, ownAddresses[], boundaryStart, boundaryEnd, transport, model }
// <import-dir>/batches/*.json      arrays of messages (import schema; compact keys accepted, see expand())
// <import-dir>/extractions/*.json  arrays of §27 extractions keyed by threadKey
// Progress is saved to <import-dir>/progress.json after every file, so a rerun resumes; the server is idempotent
// on account + Gmail message id, so replaying a batch never duplicates anything. The bearer token is read from
// .dev.vars (MAIL_IMPORT_TOKEN, else JOBS_TICK_TOKEN) or the environment and is never printed.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [dir, ...rest] = process.argv.slice(2);
if (!dir) { console.error("Usage: node scripts/mail-import.mjs <import-dir> [--base url] [--from-start]"); process.exit(1); }
const base = (rest.includes("--base") ? rest[rest.indexOf("--base") + 1] : "http://localhost:5180/os").replace(/\/$/, "");
const vars = existsSync(".dev.vars") ? Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])) : {};
const token = process.env.MAIL_IMPORT_TOKEN ?? vars.MAIL_IMPORT_TOKEN ?? process.env.JOBS_TICK_TOKEN ?? vars.JOBS_TICK_TOKEN;
if (!token) { console.error("No MAIL_IMPORT_TOKEN / JOBS_TICK_TOKEN available."); process.exit(1); }

const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const progressFile = path.join(dir, "progress.json");
const progress = !rest.includes("--from-start") && existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, "utf8")) : { batches: [], extractions: [], counts: {} };
const save = () => writeFileSync(progressFile, JSON.stringify(progress, null, 1));

async function post(body) {
  const r = await fetch(`${base}/api/mail-intel/import`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${body.op}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

/** Compact keys → import schema. */
function expand(m) {
  if (m.gmailMessageId) return m;
  return { account: manifest.account, gmailMessageId: m.i, gmailThreadId: m.t, internalDate: m.d, from: m.f, to: m.to ?? [], cc: m.cc ?? [], bcc: m.bcc ?? [], subject: m.s ?? "", snippet: m.n ?? "", body: m.b ?? null, labels: m.l ?? [],
    attachments: (m.a ?? []).map((a, k) => typeof a === "string" ? { id: `${m.i}:${k}`, filename: a } : a), displayUrl: `https://mail.google.com/mail/?authuser=${manifest.account}#all/${m.i}` };
}

await post({ op: "source", account: manifest.account, mandateId: manifest.mandateId, ownAddresses: manifest.ownAddresses, boundaryStart: manifest.boundaryStart, boundaryEnd: manifest.boundaryEnd });
const run = await post({ op: "start", account: manifest.account, transport: manifest.transport ?? "import", model: manifest.model ?? "none" });
const tally = progress.counts;
for (const f of readdirSync(path.join(dir, "batches")).filter(f => f.endsWith(".json")).sort()) {
  if (progress.batches.includes(f)) continue;
  const msgs = JSON.parse(readFileSync(path.join(dir, "batches", f), "utf8")).map(expand);
  for (let i = 0; i < msgs.length; i += 150) {
    const c = await post({ op: "batch", account: manifest.account, batchId: `${f}:${i}`, messages: msgs.slice(i, i + 150) });
    for (const [k, v] of Object.entries(c)) tally[k] = (tally[k] ?? 0) + v;
  }
  progress.batches.push(f); save();
  console.log(`batch ${f}: ${msgs.length} messages`);
}
console.log("rebuild:", JSON.stringify(await post({ op: "rebuild", account: manifest.account })));
const exDir = path.join(dir, "extractions");
if (existsSync(exDir)) for (const f of readdirSync(exDir).filter(f => f.endsWith(".json")).sort()) {
  if (progress.extractions.includes(f)) continue;
  const res = await post({ op: "extract", account: manifest.account, model: manifest.model ?? "unknown", extractions: JSON.parse(readFileSync(path.join(exDir, f), "utf8")) });
  const bad = res.filter(r => !r.ok);
  console.log(`extractions ${f}: ${res.length - bad.length} applied${bad.length ? `, ${bad.length} failed: ${bad.map(b => `${b.threadKey} ${b.error}`).join("; ")}` : ""}`);
  progress.extractions.push(f); save();
}
await post({ op: "finish", runId: run.id, counts: tally, status: "complete" });
console.log("done:", JSON.stringify(tally));

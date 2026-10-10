// Phase 26: colours come from styles/tokens.css so dark mode reaches every screen. Fails when a literal hex colour
// appears in app/ or components/ outside the allowed places (Atlas map styles need literals; the sign-in motif and the
// Appearance preview swatches show fixed colours on purpose; placeholders that show an example value are fine).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOW = ["/map/", "field-motif.tsx", "/(auth)/", "/portal/", "/api/", "appearance.module.css"];
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = ["app", "components"].flatMap(walk).filter(f => /\.(tsx|css)$/.test(f) && !ALLOW.some(a => f.split("\\").join("/").includes(a)));
const bad = [];
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g)) {
      const before = line.slice(0, m.index);
      if (/placeholder="$/.test(before) || /href=["'{`]*$/.test(before)) continue;
      bad.push(`${f}:${i + 1}: ${m[0]}`);
    }
  });
}
if (bad.length) { console.error(`Literal colours outside styles/tokens.css (use a token):\n${bad.join("\n")}`); process.exit(1); }
console.log("colours ok");

// Phase 26 dark mode: every dark token pair used for text and controls meets WCAG AA, and the light/dark blocks agree.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, themeOrDefault } from "@/lib/theme";
import { pinTarget } from "@/lib/pins/vocab";

const css = readFileSync(join(__dirname, "..", "..", "styles", "tokens.css"), "utf8");
const dark = Object.fromEntries([...css.slice(css.indexOf(':root[data-theme="dark"]')).split("}")[0].matchAll(/(--[a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));

describe("dark theme tokens", () => {
  it("text on canvas, surfaces and selected rows is readable (AA 4.5:1)", () => {
    for (const bg of ["--bg", "--surface", "--surface-selected", "--secondary-surface", "--header-surface"]) {
      expect(contrast(dark["--text-1"], dark[bg]), `text-1 on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark["--text-2"], dark[bg]), `text-2 on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark["--text-3"], dark[bg]), `text-3 on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark["--link"], dark[bg]), `link on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("buttons, alerts and status colours stay legible", () => {
    expect(contrast(dark["--action-text"], dark["--action"])).toBeGreaterThanOrEqual(4.5);
    for (const t of ["--critical", "--warning", "--positive", "--gold", "--copper-ink", "--accent-ink"]) expect(contrast(dark[t], dark["--surface"]), t).toBeGreaterThanOrEqual(4.5);
    for (const t of ["--copper", "--lichen", "--water", "--plum", "--steel"]) expect(contrast(dark[t], dark["--surface"]), t).toBeGreaterThanOrEqual(3);
  });
  it("Match my device uses the same palette as Dark", () => {
    const sys = css.slice(css.indexOf(':root[data-theme="system"]')).split("}")[0];
    for (const [k, v] of Object.entries(dark)) expect(sys.includes(`${k}:${v}`), k).toBe(true);
  });
  it("unknown preferences fall back to light", () => {
    expect(themeOrDefault("dark")).toBe("dark");
    expect(themeOrDefault("neon")).toBe("light");
    expect(themeOrDefault(undefined)).toBe("light");
    expect(pinTarget("/appearance")).toBeNull();
  });
});

// Navigation preservation (phase 10 §3; navigation prompt §43): every page route is reachable from the consolidated
// navigation, either directly or as a detail/sub page of a listed route. A new page that nobody can reach fails here.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { flatNav, NAV, navFor, SETTINGS_NAV } from "@/lib/nav";

const APP = join(__dirname, "..", "..", "app", "(app)");
const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
const routes = walk(APP).filter(f => f.endsWith("page.tsx")).map(f => "/" + relative(APP, f).split(sep).slice(0, -1).join("/")).map(r => (r === "/" ? "/" : r));
const navPaths = new Set([...NAV.flatMap(g => [g.href, ...g.sections.flatMap(s => s.items.map(i => i.href))]), ...SETTINGS_NAV.map(i => i.href)].filter(Boolean).map(h => h!.split("?")[0]));

/** Reached from inside another screen (a create form, a print view, a run of a playbook), each named with where. */
const CONTEXTUAL: Record<string, string> = {
  "/people/new": "People → Add person", "/people/import": "People → Import", "/companies/new": "Organizations → Add",
  "/contracts/[id]/print": "Contract → Print", "/prospecting/playbooks/[key]": "Prospecting → playbook cards", "/playbooks/runs/[id]": "Playbook → run",
  "/documents/generator/[id]": "Document generator → document",
  "/map/briefs": "Atlas → Site briefs (project page and Projects landing)",
  "/settings": "Sidebar footer → Settings (redirects to its first section)",
};

describe("navigation inventory", () => {
  it("every page route is in the navigation or is a detail page of one that is", () => {
    const orphans = routes.filter(r => {
      if (navPaths.has(r) || CONTEXTUAL[r]) return false;
      // Detail pages: /x/[id] (or /x/y/[id]) whose list /x is navigable.
      const parent = r.replace(/\/\[[^\]]+\](\/.*)?$/, "");
      return !(r.includes("[") && (navPaths.has(parent) || [...navPaths].some(p => parent.startsWith(p + "/") || p.startsWith(parent))));
    });
    expect(orphans).toEqual([]);
  });

  it("every navigation link points at an existing page", () => {
    const existing = new Set(routes);
    // Dynamic routes (/overview/[key]) match any single segment in their place.
    const patterns = routes.filter(r => r.includes("[")).map(r => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`));
    const dead = [...navPaths].filter(p => !existing.has(p) && !patterns.some(re => re.test(p)));
    expect(dead).toEqual([]);
  });

  it("the sidebar keeps the frozen top-level set", () => {
    expect(NAV.map(g => g.label)).toEqual(["Command", "Atlas", "Mandates", "Projects", "Systems", "Capital", "Opportunities", "Relationships", "Intelligence", "Clients", "Operations"]);
  });

  it("clients see only entitled modules and never Regenera-internal groups", () => {
    const client = navFor({ modules: ["command", "atlas", "projects", "documents", "reporting", "automations"], internal: false });
    expect(client.map(g => g.key)).toEqual(["command", "atlas", "projects", "systems", "intelligence", "operations"]);
    expect(client.find(g => g.key === "intelligence")!.sections[0].items.map(i => i.href)).toEqual(["/reports", "/reports?tab=cases"]);
    const hrefs = flatNav({ modules: ["command"], internal: false }).map(f => f.href);
    expect(hrefs).not.toContain("/commercial");
    expect(hrefs).not.toContain("/settings/jobs");
    expect(hrefs).toContain("/org");
    expect(navFor({ modules: "all", internal: true }).map(g => g.key)).toContain("clients");
  });
});

describe("project context tabs", () => {
  it("every Project 360 tab belongs to exactly one context group", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(join(__dirname, "..", "..", "app", "(app)", "projects", "[id]", "page.tsx"), "utf8");
    const tabs = [...src.slice(src.indexOf("const TABS"), src.indexOf("] as const;", src.indexOf("const TABS"))).matchAll(/\["(\w+)", "/g)].map(m => m[1]);
    const groups = src.slice(src.indexOf("const TAB_GROUPS"), src.indexOf("];", src.indexOf("const TAB_GROUPS")));
    const grouped = [...groups.matchAll(/tabs: \[([^\]]+)\]/g)].flatMap(m => [...m[1].matchAll(/"(\w+)"/g)].map(x => x[1]));
    expect(tabs.length).toBeGreaterThan(20);
    expect([...grouped].sort()).toEqual([...tabs].sort());
  });
});

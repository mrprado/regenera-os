// Navigation preservation (phase 10 §3; navigation prompt §43): every page route is reachable from the consolidated
// navigation, either directly or as a detail/sub page of a listed route. A new page that nobody can reach fails here.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { activeNavGroup, flatNav, NAV, navFor, SETTINGS_NAV, UNPLACED } from "@/lib/nav";

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
  "/projects/portfolio/memo": "Projects → Portfolio screening → Portfolio memo (needs a sponsor)",
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

  it("the authorized redesign preserves work areas and task-focused primary ordering", () => {
    expect(NAV.filter(g=>g.tier==='primary').map(g => g.label)).toEqual(["Command", "Atlas", "Discover", "Projects", "Capital", "Network", "Intelligence", "Engage", "Workflows", "Steward"]);
    // October 2026 redesign: ten work areas (plus Settings, with your profile in it); no section headings.
    expect([...new Set(NAV.map(g => g.section ?? ""))]).toEqual([""]);
    expect(SETTINGS_NAV.some(i => i.href === "/profile")).toBe(true);
    // Phase 24: every legacy destination is placed in a group; administration lives in Settings.
    expect(UNPLACED).toEqual([]);
    for (const h of ["/settings/jobs", "/settings/claude", "/connect/mcp"]) expect(SETTINGS_NAV.some(i => i.href === h)).toBe(true);
    const staff = navFor({ modules: "all", internal: true, owner: true });
    const owner = (href: string) => { const [p, q] = href.split("?"); return activeNavGroup(staff, p, new URLSearchParams(q))?.key; };
    expect([owner("/origination"), owner("/origination?tab=screening"), owner("/origination?tab=stewardship"), owner("/funding?tab=bids"), owner("/funding?tab=funders"), owner("/deals/x"), owner("/approvals"), owner("/start"), owner("/contracts?tab=obligations"), owner("/power"), owner("/reports")])
      .toEqual(["discover", "projects", "steward", "capital", "capital", "engage", "command", "command", "steward", "projects", "intelligence"]);
    // Former group overviews and phase 24 loop steps keep their URLs and highlight the area that owns them.
    expect(["mandates", "find", "systems", "qualify", "relationships", "reach", "deals", "clients", "win", "operations", "deliver", "steward"].map(k => owner(`/overview/${k}`)))
      .toEqual(["discover", "discover", "projects", "projects", "network", "network", "engage", "engage", "engage", "workflows", "workflows", "steward"]);
  });

  it("clients see only entitled modules and never Regenera-internal groups", () => {
    const client = navFor({ modules: ["command", "atlas", "projects", "documents", "reporting", "automations"], internal: false });
    expect(client.map(g => g.key)).toEqual(["command", "atlas", "projects", "capital", "intelligence", "workflows", "steward"]);
    expect(client.find(g => g.key === "intelligence")!.sections.flatMap(s => s.items.map(i => i.href))).toEqual(["/reports", "/reports?tab=cases"]);
    expect(client.find(g => g.key === "steward")!.sections.flatMap(s => s.items.map(i => i.href))).toEqual(["/projects?stage=operations"]);
    expect(client.flatMap(g => g.sections.flatMap(s => s.items.map(i => i.href)))).not.toContain("/origination");
    const hrefs = flatNav({ modules: ["command"], internal: false }).map(f => f.href);
    expect(hrefs).not.toContain("/commercial");
    expect(hrefs).not.toContain("/settings/jobs");
    expect(hrefs).toContain("/org");
    // Client pages now sit inside Deals: staff reach them, clients never do.
    expect(flatNav({ modules: "all", internal: true }).map(f => f.href)).toEqual(expect.arrayContaining(["/clients", "/commercial", "/systems"]));
    expect(flatNav({ modules: "all", internal: false }).map(f => f.href)).not.toContain("/clients");
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

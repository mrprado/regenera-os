// Static check of SPEC sections 13 and 23: the Site is public, so every route must protect itself.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..", "..", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(APP).map(f => ({ path: relative(APP, f).split(sep).join("/"), src: readFileSync(f, "utf8") }));

// Anonymous API routes and the verifier each must call (SPEC section 23).
// Phase 0 builds jobs/tick and oauth callback; the rest arrive in later phases with the same rule.
const ANONYMOUS_API: Record<string, RegExp> = {
  "api/jobs/tick/route.ts": /bearerMatches\(/,
  "api/oauth/google/callback/route.ts": /verifyState\(/,
  "api/webhooks/site/route.ts": /verifySiteSignature\(/,
  "api/webhooks/extension/route.ts": /verifyExtensionToken\(/,
  "api/unsubscribe/[token]/route.ts": /verifyUnsubscribeToken\(/,
  // Phase 4: the MCP server and its OAuth endpoints (docs/plans/phase-4.md item 2).
  "api/mcp/route.ts": /handleMcp\(/,
  "api/oauth/mcp/register/route.ts": /registerClient\(/,
  "api/oauth/mcp/token/route.ts": /exchangeToken\(/,
  // Email + password sign-in (docs/DEPLOY.md): each checks Origin and does only its own step.
  "api/auth/signin/route.ts": /verifyPassword\(/,
  "api/auth/signout/route.ts": /endSession\(/,
  // Client operating layer: an invited OS user sets a password from a one-time token.
  "api/auth/accept/route.ts": /acceptOsInvite\(/,
  // External portals and public intake (master build instruction §02, §69): own sessions, own checks.
  "api/portal/signin/route.ts": /portalSignIn\(/,
  "api/portal/signout/route.ts": /endPortalSession\(/,
  "api/portal/invite/route.ts": /acceptInvite\(/,
  "api/portal/doc/[id]/route.ts": /canOpenDocument\(/,
  "api/intake/[kind]/route.ts": /submitIntake\(/,
};
// Pages reachable without an OS membership. Each is listed with why.
const ANONYMOUS_PAGES: Record<string, string> = {
  "page.tsx": "redirects to /today, renders nothing",
  "(auth)/not-allowed/page.tsx": "the 403 page itself",
  "(auth)/signin/page.tsx": "the sign-in form",
  "(auth)/join/[token]/page.tsx": "sets a password from a one-time OS invite token (openInvite)",
  "(portal)/portal/signin/page.tsx": "the portal sign-in form",
  "(portal)/portal/invite/[token]/page.tsx": "sets a password from a one-time invite token (inviteUser)",
  "(portal)/portal/page.tsx": "redirects to the portal home or sign-in, renders nothing",
  "(public)/intake/[kind]/page.tsx": "public intake form; submits to api/intake with honeypot and rate limit",
};

describe("route guard", () => {
  it("every page under (app) calls requireOsUser or requireOsOwner itself", () => {
    const pages = files.filter(f => f.path.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      if (ANONYMOUS_PAGES[page.path]) continue;
      if (page.path.startsWith("(portal)/")) {
        // External portals: their own session and kind check; never the OS session.
        expect(/requirePortalUser\(/.test(page.src), `${page.path} does not call requirePortalUser`).toBe(true);
        continue;
      }
      expect(page.path.startsWith("(app)/"), `${page.path} is outside (app) and not on the anonymous list`).toBe(true);
      expect(/require(OsUser|OsOwner)\(/.test(page.src), `${page.path} does not call requireOsUser`).toBe(true);
    }
  });

  it("the (app) layout guards too", () => {
    const layout = files.find(f => f.path === "(app)/layout.tsx");
    expect(layout?.src).toMatch(/requireOsUser\(/);
  });

  it("every API route is guarded or is an anonymous route that calls its verifier", () => {
    for (const route of files.filter(f => f.path.startsWith("api/") && f.path.endsWith("route.ts"))) {
      const verifier = ANONYMOUS_API[route.path];
      if (verifier) {
        expect(verifier.test(route.src), `${route.path} must call ${verifier}`).toBe(true);
      } else {
        expect(/getOsApiUser\(|withOsUser\(/.test(route.src), `${route.path} is not guarded`).toBe(true);
      }
    }
  });

  it("every exported server action is wrapped in withOsUser", () => {
    for (const file of files.filter(f => /^\s*["']use server["']/.test(f.src))) {
      const exported = [...file.src.matchAll(/export async function (\w+)\s*\(/g)].map(m => m[1]);
      for (const name of exported) {
        const start = file.src.indexOf(`export async function ${name}`);
        const next = file.src.indexOf("export async function", start + 1);
        const body = file.src.slice(start, next === -1 ? undefined : next);
        const guard = file.path.startsWith("(portal)/") ? /withPortalUser\(|anyUser\(\)/ : /withOsUser\(/;
        expect(guard.test(body), `${file.path}: ${name} is not wrapped in its guard`).toBe(true);
      }
    }
  });

  it("portal code never resolves the internal OS session", () => {
    for (const f of files.filter(x => x.path.startsWith("(portal)/") || x.path.startsWith("(public)/") || x.path.startsWith("api/portal/") || x.path.startsWith("api/intake/"))) {
      expect(/requireOsUser|withOsUser|getOsApiUser|currentEmail/.test(f.src), `${f.path} touches the OS session`).toBe(false);
    }
  });

  it("anonymous pages list only existing files", () => {
    for (const path of Object.keys(ANONYMOUS_PAGES)) expect(files.some(f => f.path === path), path).toBe(true);
  });

  it("nothing trusts identity headers a client could send (the OS runs on a plain Worker)", () => {
    for (const f of files) expect(f.src.includes("oai-authenticated"), `${f.path} reads a Sites identity header`).toBe(false);
  });

  it("private investor data never reaches Ask the OS or the MCP server", () => {
    const lib = join(__dirname, "..", "..", "lib");
    for (const dir of ["ask", "mcp"]) {
      for (const f of readdirSync(join(lib, dir))) {
        const src = readFileSync(join(lib, dir, f), "utf8");
        expect(/privateCapitalProfiles|investorQualifications|kycChecks|private_capital_profiles|investor_qualifications|kyc_checks/.test(src), `lib/${dir}/${f} touches private investor data`).toBe(false);
      }
    }
  });

  it("heavy ATLAS libraries load only inside the map route (the rest of the OS never ships them)", () => {
    for (const f of files) {
      if (f.path.startsWith("(app)/map/")) continue;
      expect(/from ["'](maplibre-gl|satellite\.js|d3-contour|cesium|deck\.gl|@deck\.gl\/[\w-]+)["']/.test(f.src), `${f.path} imports an ATLAS-only library`).toBe(false);
    }
  });

  it("culturally governed knowledge and community records never reach Ask the OS, the MCP server or global search", () => {
    const lib = join(__dirname, "..", "..", "lib");
    const re = /knowledgeRecords|knowledgeHolders|knowledgePermissions|knowledgeUses|consentRecords|communityEngagements|communityGrievances|knowledge_records|knowledge_holders|consent_records|community_engagements|community_grievances/;
    const targets = [...["ask", "mcp"].flatMap(dir => readdirSync(join(lib, dir)).map(f => join(lib, dir, f))), join(lib, "search.ts")];
    for (const p of targets) expect(re.test(readFileSync(p, "utf8")), `${p} touches governed knowledge or community records`).toBe(false);
  });
});

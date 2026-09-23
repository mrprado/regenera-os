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
};
// Pages reachable without an OS membership. Each is listed with why.
const ANONYMOUS_PAGES: Record<string, string> = {
  "page.tsx": "redirects to /today, renders nothing",
  "(auth)/not-allowed/page.tsx": "the 403 page itself",
};

describe("route guard", () => {
  it("every page under (app) calls requireOsUser or requireOsOwner itself", () => {
    const pages = files.filter(f => f.path.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      if (ANONYMOUS_PAGES[page.path]) continue;
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
        expect(/withOsUser\(/.test(body), `${file.path}: ${name} is not wrapped in withOsUser`).toBe(true);
      }
    }
  });

  it("anonymous pages list only existing files", () => {
    for (const path of Object.keys(ANONYMOUS_PAGES)) expect(files.some(f => f.path === path), path).toBe(true);
  });
});

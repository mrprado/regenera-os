import { describe, expect, it } from "vitest";
import { CANDIDATES, candidateStatus } from "@/lib/integrations/candidates";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { capacityFloor } from "@/lib/infrastructure/queries";
import { gppdRow } from "@/lib/infrastructure/gppd";
import { fundingCovers } from "@/lib/site-intel/opportunity";

describe("phase 21 §2 global source registry", () => {
  it("covers every domain of the master registry with unique names", () => {
    expect(new Set(CANDIDATES.map(c => c.name)).size).toBe(CANDIDATES.length);
    expect(new Set(CANDIDATES.map(c => c.domain)).size).toBe(21);
    expect(CANDIDATES.length).toBeGreaterThan(200);
  });
  it("links only to real integration registry keys", () => {
    const keys = new Set(INTEGRATIONS.map(i => i.key));
    for (const c of CANDIDATES) if (c.registryKey) expect(keys.has(c.registryKey), `${c.name} → ${c.registryKey}`).toBe(true);
  });
  it("paid feeds are tier 3, never tier 1", () => {
    for (const c of CANDIDATES.filter(x => x.auth === "paid")) expect(c.tier, c.name).toBe(3);
  });
  it("status is computed from registry, ledger and downstream, never asserted", () => {
    const reg = new Set(["gleif", "gem"]);
    const ok = new Map([["gleif", new Date().toISOString()]]);
    expect(candidateStatus({ registryKey: "gleif" }, reg, ok, new Map())).toBe("ingesting");
    expect(candidateStatus({ registryKey: "gleif" }, reg, ok, new Map([["gleif", 5]]))).toBe("reaching");
    expect(candidateStatus({ registryKey: "gem" }, reg, ok, new Map())).toBe("registered");
    expect(candidateStatus({}, reg, ok, new Map())).toBe("candidate");
  });
});

describe("phase 21 §3 registry-listed plants and site capital stage", () => {
  it("parses a GPPD row and rejects invalid coordinates", () => {
    const h = new Map(["country", "name", "gppd_idnr", "capacity_mw", "latitude", "longitude", "primary_fuel", "commissioning_year", "owner", "source", "url"].map((k, i) => [k, i]));
    const r = gppdRow(h, ["NAM", "Hardap Solar", "WRI1234", "37", "-24.5", "17.9", "Solar", "2018.0", "InnoSun", "Namibia ECB", "https://example.org"]);
    expect(r).toMatchObject({ country: "NAM", fuel: "Solar", capacityMw: 37, commissioningYear: 2018, lat: -24.5, lng: 17.9 });
    expect(gppdRow(h, ["NAM", "x", "WRI9", "5", "0", "0", "Solar", "", "", "", ""])).toBeNull();
  });
  it("thins the globe by capacity at low zoom", () => {
    expect(capacityFloor(2)).toBe(500);
    expect(capacityFloor(8)).toBe(0);
  });
  it("funding geography: listed country, global, unstated and other", () => {
    expect(fundingCovers(["Namibia", "Botswana"], "NAM")).toBe("listed");
    expect(fundingCovers(["Developing countries"], "NAM")).toBe("global");
    expect(fundingCovers(null, "NAM")).toBe("unstated");
    expect(fundingCovers(["United States"], "NAM")).toBe("no");
  });
});

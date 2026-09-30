// Evidence-based capital fit (hardening prompt §13): dimensions from the recorded mandate, never a percentage.
import { describe, expect, it } from "vitest";
import { commercialFit } from "@/lib/capital/engine";
import { fitEvidence } from "@/lib/capital/fit-evidence";

const target = { country: "Mexico", sector: "energy", stage: "development", instrument: "equity", ticketMin: 10_000_000, ticketMax: 20_000_000, currency: "USD" };
const crit = (o: Partial<Parameters<typeof commercialFit>[0]>) => ({ geographies: [], sectors: [], stages: [], instruments: [], ticketMin: null, ticketMax: null, currency: null, ...o }) as Parameters<typeof commercialFit>[0];

describe("fit evidence", () => {
  it("reads every dimension from the engine's reasons", () => {
    const full = commercialFit(crit({ geographies: ["Mexico"], sectors: ["energy"], stages: ["development"], instruments: ["equity"], ticketMin: 5_000_000, ticketMax: 50_000_000, currency: "USD" }), target as never);
    expect(fitEvidence(full.reasons)).toMatchObject({ basis: "known_mandate" });
    const partial = commercialFit(crit({ geographies: ["Mexico"], sectors: ["energy"] }), target as never);
    const p = fitEvidence(partial.reasons);
    expect(p.basis).toBe("partial");
    expect(p.dims.find(d => d.dimension === "Stage")?.status).toBe("unknown");
    const conflict = commercialFit(crit({ geographies: ["Kenya"], sectors: ["energy"], stages: ["development"] }), target as never);
    const c = fitEvidence(conflict.reasons);
    expect(c.basis).toBe("conflict");
    expect(c.dims.find(d => d.dimension === "Geography")?.status).toBe("conflict");
    expect(fitEvidence(commercialFit(crit({}), target as never).reasons).basis).toBe("unverified");
  });

  it("no capital page displays the internal score", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["opportunities/[id]", "partners/[id]", "private/[id]"]) {
      const src = readFileSync(`app/(app)/capital/${f}/page.tsx`, "utf8");
      expect(src.match(/\{[^}]*commercialScore[^}]*\}/g)?.filter(x => !x.includes("orderBy")) ?? []).toEqual([]);
    }
  });
});

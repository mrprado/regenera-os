import { describe, expect, it } from "vitest";
import type { RegistryData } from "@/db/casework";
import { productMentions } from "@/lib/compliance/guardrails";
import { REQUEST_TEMPLATES } from "@/lib/documents/requests";
import { zExtraction } from "@/lib/documents/extract";
import { portfolioCsv } from "@/lib/portfolio/screen";
import { diffRegistry, normalizeRegistry } from "@/lib/registry/companies-house";

describe("regulated-product mentions", () => {
  const products = [{ name: "RA-ESG Income Bond", aliases: ["Growth Bond"] }, { name: "Preference Shares", aliases: [] }];
  it("finds whole names and aliases, ignoring case and punctuation", () => {
    expect(productMentions("Would the ra-esg income bond suit you?", products)).toEqual(["RA-ESG Income Bond"]);
    expect(productMentions("our GROWTH BOND pays", products)).toEqual(["RA-ESG Income Bond"]);
    expect(productMentions("project debt for a 54 MW solar plant", products)).toEqual([]);
    expect(productMentions("bondholders", products)).toEqual([]);
  });
});

describe("registry snapshots", () => {
  const base: RegistryData = { status: "active", incorporated: "2023-09-05", type: "plc", sic: [], accountsNextDue: "2027-03-31", accountsLastMadeUpTo: "2025-09-30", accountsOverdue: false,
    officers: [{ name: "VIEIRA, David", role: "director", appointed: "2023-09-05", resigned: null }], charges: [{ code: "151150860001", status: "outstanding", created: "2024-02-28", entitled: ["Amicorp (UK) Ltd"] }], filings: [] };
  it("records appointments, resignations, charges, status and overdue accounts", () => {
    const next: RegistryData = { ...base, accountsOverdue: true, officers: [{ ...base.officers[0], resigned: "2026-04-20" }, { name: "MUSKAT, Shaun", role: "director", appointed: "2026-04-13", resigned: null }],
      charges: [{ ...base.charges[0], status: "fully-satisfied" }, { code: "151150860002", status: "outstanding", created: "2026-09-01", entitled: ["Lender Ltd"] }] };
    const d = diffRegistry(base, next).map(c => c.detail);
    expect(d).toEqual(expect.arrayContaining(["Accounts now overdue", "director resigned: VIEIRA, David (2026-04-20)", "director appointed: MUSKAT, Shaun (2026-04-13)", "Charge 151150860001: outstanding → fully-satisfied", "New charge 151150860002 (outstanding) for Lender Ltd"]));
    expect(diffRegistry(null, base)).toEqual([]);
    expect(diffRegistry(base, base)).toEqual([]);
  });
  it("normalizes the Companies House API shapes", () => {
    const n = normalizeRegistry({ company_status: "active", accounts: { next_due: "2027-03-31", overdue: false, last_accounts: { made_up_to: "2025-09-30" } } }, { items: [{ name: "A", officer_role: "secretary" }] }, { items: [] }, { items: [{ date: "2026-07-28", type: "AA", description: "accounts-with-accounts-type-full" }] });
    expect(n.officers).toEqual([{ name: "A", role: "secretary", appointed: null, resigned: null }]);
    expect(n.filings[0].description).toBe("accounts with accounts type full");
  });
});

describe("document requests and extraction contract", () => {
  it("the institutional template has the 12 readiness sections", () => {
    expect(REQUEST_TEMPLATES.institutional.sections).toHaveLength(12);
    expect(REQUEST_TEMPLATES.institutional.sections.flatMap(s => s.items).some(i => /P50\/P90/.test(i))).toBe(true);
  });
  it("extraction output is validated: figures stay null when not stated", () => {
    const ok = zExtraction.safeParse({ sponsor: { name: "RA-ESG PLC", country: "GBR" }, projects: [{ name: "Keetmanshoop (NAM1)", country: "NAM", locality: "Keetmanshoop", capacityMw: 54, annualGwh: 100, storage: "180 min Na-ion", tariff: "$0.08/kWh", capexUsd: 60000000, financing: "95% FEPC / 5% seed", offtake: "NamPower", status: null, page: 18 }], statements: [] });
    expect(ok.success).toBe(true);
    expect(zExtraction.safeParse({ sponsor: null, projects: [{ name: "x" }], statements: [] }).success).toBe(false);
  });
  it("portfolio CSV quotes every cell", () => {
    const csv = portfolioCsv([{ id: "1", name: "A, \"quoted\"", country: "NAM", stage: "opportunity", capacityMw: 54, precision: "town", located: true, energyGwh: 100, yield: null, lanes: {}, programmes: 12, roomFilled: 0, roomTotal: 11, openItems: 3 }]);
    expect(csv.split("\n")[1]).toMatch(/^"A, ""quoted""","NAM"/);
  });
});

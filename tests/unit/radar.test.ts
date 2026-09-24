import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { excelDate, parseSbtiXlsx, parseTnfd } from "@/lib/radar/lists";
import { linkFor, toPeopleParams } from "@/lib/radar/saved-searches";
import { median } from "@/lib/reports/metrics";
import { lastWeek } from "@/lib/reports/weekly";
import { suggestedTitles } from "@/lib/triggers/pursue";

const TNFD = `<table><tr><th>Organisation and HQ Country or Area</th><th>TNFD-aligned disclosure(s) by financial year</th></tr>
<tr>
  <td data-label="Organisation and HQ Country or Area"><div class="bold h6 mb-sm">Agua &amp; Tierra S.A.</div><div class="flex align-center">
    <!-- <img data-temp="Chile" alt="cl"> -->
    Chile </div></td>
  <td data-label="TNFD-aligned disclosure(s) by financial year">2025</td>
  <td data-label="Sector Classification (SASB)">Water Utilities &amp; Services</td>
  <td data-label="Type of Institution">Corporate</td>
  <td data-label="Publicly listed company">Yes</td>
</tr>
<tr>
  <td data-label="Organisation and HQ Country or Area"><div class="bold h6 mb-sm">Pixel Data Ltd</div><div>United Kingdom</div></td>
  <td data-label="TNFD-aligned disclosure(s) by financial year">2024<br/><span class="small">(or earlier)</span></td>
  <td data-label="Sector Classification (SASB)">Software &amp; IT Services</td>
  <td data-label="Type of Institution">Corporate</td>
  <td data-label="Publicly listed company">No</td>
</tr>
<tr>
  <td data-label="Organisation and HQ Country or Area"><div class="bold h6 mb-sm">Andean Development Bank</div><div>Peru</div></td>
  <td data-label="TNFD-aligned disclosure(s) by financial year">2026</td>
  <td data-label="Sector Classification (SASB)">Development Bank</td>
  <td data-label="Type of Institution">Development Bank or Multilateral Finance Institution</td>
  <td data-label="Publicly listed company">No</td>
</tr></table>`;

describe("TNFD adopters parser", () => {
  it("reads name, country, sector and type, and applies the scope filter", () => {
    const rows = parseTnfd(TNFD);
    expect(rows.map(r => [r.name, r.country, r.inScope, r.leadSource])).toEqual([
      ["Agua & Tierra S.A.", "Chile", true, "compliance"],
      ["Pixel Data Ltd", "United Kingdom", false, "compliance"],
      ["Andean Development Bank", "Peru", true, "mandate_match"],
    ]);
    expect(rows[1].detail.disclosure).toBe("2024 (or earlier)");
  });
});

describe("SBTi xlsx parser", () => {
  it("streams the sheet before the shared strings and resolves only what it needs", async () => {
    const strings = ["sbti_id", "company_name", "organization_type", "location", "sector", "date_updated", "Aguas Andinas", "Corporate", "Chile", "Water Utilities", "A very long target text that is never needed", "Tiny Bakery", "SME", "Food and Beverage Processing"];
    const sst = `<?xml version="1.0"?><sst count="${strings.length}">${strings.map(s => `<si><t>${s}</t></si>`).join("")}</sst>`;
    const c = (ref: string, s: number) => `<c r="${ref}" t="s"><v>${s}</v></c>`;
    const sheet = `<?xml version="1.0"?><worksheet><sheetData>
      <row r="1">${c("A1", 0)}${c("B1", 1)}${c("E1", 2)}${c("F1", 3)}${c("H1", 4)}${c("V1", 5)}</row>
      <row r="2"><c r="A2"><v>4.0014373E7</v></c>${c("B2", 6)}${c("E2", 7)}${c("F2", 8)}${c("H2", 9)}${c("Q2", 10)}<c r="V2"><v>46275.5</v></c></row>
      <row r="3"><c r="A3"><v>40099999</v></c>${c("B3", 11)}${c("E3", 12)}${c("F3", 8)}${c("H3", 13)}</row>
    </sheetData></worksheet>`;
    // Same order as the real file: the sheet comes before sharedStrings in the archive.
    const zip = zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(sst) });
    async function* chunks() { for (let i = 0; i < zip.length; i += 97) yield zip.subarray(i, i + 97); }
    const rows = await parseSbtiXlsx(chunks());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "40014373", name: "Aguas Andinas", country: "Chile", sector: "Water Utilities", inScope: true, detail: { type: "Corporate", updated: "2026-09-10" } });
    expect(rows[1]).toMatchObject({ name: "Tiny Bakery", inScope: false }); // SMEs are out of scope
  });

  it("converts Excel serial dates", () => {
    expect(excelDate("44595.041666666664")).toBe("2022-02-03");
    expect(excelDate("")).toBeNull();
    expect(excelDate("2030.0")).toBeNull();
  });
});

describe("helpers", () => {
  it("reads suggested titles safely", () => {
    expect(suggestedTitles({ suggestedEngagement: JSON.stringify({ titles: ["CIO", 3, "Head of Impact"] }) })).toEqual(["CIO", "Head of Impact"]);
    expect(suggestedTitles({ suggestedEngagement: "not json" })).toEqual([]);
    expect(suggestedTitles({ suggestedEngagement: null })).toEqual([]);
  });

  it("keeps only Apollo people-search parameters", () => {
    expect(toPeopleParams({ person_titles: ["cio"], q_keywords: "impact", organization_num_employees_ranges: ["1,10"], evil: "x" })).toEqual({ person_titles: ["cio"], q_keywords: "impact" });
  });

  it("builds link-outs", () => {
    expect(linkFor("xray", 'site:linkedin.com/in "cso"')).toBe("https://www.google.com/search?q=site%3Alinkedin.com%2Fin%20%22cso%22");
    expect(linkFor("salesnav", "CIO")).toContain("linkedin.com/sales/search/people?keywords=CIO");
  });

  it("computes last week and medians", () => {
    expect(lastWeek(new Date("2026-09-28T12:00:00Z"))).toEqual({ from: "2026-09-21T00:00:00.000Z", to: "2026-09-28T00:00:00.000Z" });
    expect(lastWeek(new Date("2026-09-30T12:00:00Z")).from).toBe("2026-09-21T00:00:00.000Z");
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

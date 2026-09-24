import { describe, expect, it } from "vitest";
import { applyMapping, detectMapping, parseCsv } from "@/lib/import/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines, CRLF and BOM", () => {
    const text = '﻿Name,Company,Note\r\n"Pérez, Luis","Acme ""Renewables""","line one\nline two"\r\nAna,Blue Fund,\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Company", "Note"],
      ["Pérez, Luis", 'Acme "Renewables"', "line one\nline two"],
      ["Ana", "Blue Fund", ""],
    ]);
  });
});

describe("detectMapping", () => {
  it("recognizes an Apollo export", () => {
    const headers = ["First Name", "Last Name", "Title", "Company", "Email", "Person Linkedin Url", "Website", "City", "Country"];
    const m = detectMapping(headers);
    expect(m).toEqual({ firstName: 0, lastName: 1, title: 2, email: 4, company: 3, website: 6, linkedinUrl: 5, location: 7, country: 8 });
    const rows = applyMapping([["Ana", "Ruiz", "CIO", "Terra FO", "ana@terrafo.mx", "linkedin.com/in/ana", "terrafo.mx", "Monterrey", "Mexico"]], m);
    expect(rows[0]).toMatchObject({ fullName: "Ana Ruiz", email: "ana@terrafo.mx", company: "Terra FO" });
  });

  it("recognizes a Sales Navigator style export", () => {
    const m = detectMapping(["first_name", "last_name", "job_title", "company_name", "profile_url", "location"]);
    expect(m).toMatchObject({ firstName: 0, lastName: 1, title: 2, company: 3, linkedinUrl: 4, location: 5 });
  });
});

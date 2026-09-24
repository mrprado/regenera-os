// RFC 4180 CSV parsing and column auto-detection for People/Companies imports (phase 1 plan 2c).

/** Parses CSV text (quoted fields, escaped quotes, commas and newlines inside quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(v => v.trim() !== "")) rows.push(row);
  return rows;
}

export const IMPORT_FIELDS = {
  fullName: "Full name", firstName: "First name", lastName: "Last name", title: "Title", email: "Email",
  company: "Company", website: "Company website or domain", linkedinUrl: "LinkedIn URL", location: "Location / city", country: "Country",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;

const ALIASES: Record<ImportField, string[]> = {
  fullName: ["name", "full name", "contact name", "person name"],
  firstName: ["first name", "firstname", "given name"],
  lastName: ["last name", "lastname", "surname", "family name"],
  title: ["title", "job title", "position", "role", "headline"],
  email: ["email", "email address", "work email", "e-mail", "business email"],
  company: ["company", "company name", "organization", "organisation", "account name", "employer", "company name for emails"],
  website: ["website", "company website", "domain", "company domain", "company url"],
  linkedinUrl: ["linkedin", "linkedin url", "person linkedin url", "linkedin profile", "profile url"],
  location: ["city", "location", "person location", "region", "state"],
  country: ["country", "person country", "company country"],
};

const norm = (h: string) => h.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** Maps each import field to a column index, preferring exact alias matches. */
export function detectMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  const normalized = headers.map(norm);
  for (const field of Object.keys(ALIASES) as ImportField[]) {
    const idx = normalized.findIndex((h, i) => !used.has(i) && ALIASES[field].includes(h));
    if (idx >= 0) { mapping[field] = idx; used.add(idx); }
  }
  return mapping;
}

export type ImportRow = Partial<Record<ImportField, string>>;

export function applyMapping(rows: string[][], mapping: Partial<Record<ImportField, number>>): ImportRow[] {
  return rows.map(r => {
    const out: ImportRow = {};
    for (const [field, idx] of Object.entries(mapping) as [ImportField, number][]) {
      const v = r[idx]?.trim();
      if (v) out[field] = v;
    }
    if (!out.fullName && (out.firstName || out.lastName)) out.fullName = [out.firstName, out.lastName].filter(Boolean).join(" ");
    return out;
  });
}

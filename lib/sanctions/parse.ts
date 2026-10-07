// Parsers for the public sanctions lists. Pure: they take text chunks (the UK and EU files are tens of MB, so they are
// streamed, never held whole) and return compact entries [listId, name, kind, programme, country].

export type SanctionsEntry = [string, string, string, string, string];

/** Incremental CSV parser: push chunks, get completed rows. Handles quotes, doubled quotes and newlines in fields. */
export class CsvStream {
  private field = ""; private row: string[] = []; private quoted = false; private pendingQuote = false; private afterCr = false;
  constructor(private delimiter = ",") {}
  push(chunk: string): string[][] {
    const out: string[][] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.afterCr) { this.afterCr = false; if (c === "\n") continue; }
      if (this.quoted) {
        if (this.pendingQuote) {
          this.pendingQuote = false;
          if (c === '"') { this.field += '"'; continue; }
          this.quoted = false; // closing quote; fall through to handle c unquoted
        } else if (c === '"') { this.pendingQuote = true; continue; }
        else { this.field += c; continue; }
      }
      if (c === '"' && this.field === "") { this.quoted = true; continue; }
      if (c === this.delimiter) { this.row.push(this.field); this.field = ""; continue; }
      if (c === "\n" || c === "\r") { this.afterCr = c === "\r"; this.row.push(this.field); this.field = ""; out.push(this.row); this.row = []; continue; }
      this.field += c;
    }
    return out;
  }
  end(): string[][] {
    if (this.pendingQuote) { this.pendingQuote = false; this.quoted = false; }
    if (this.field !== "" || this.row.length) { this.row.push(this.field); const r = this.row; this.row = []; this.field = ""; return [r]; }
    return [];
  }
}

const clean = (s: string | undefined) => (s ?? "").replace(/^-0-\s*$/, "").replace(/\s+/g, " ").trim();

/** Collects unique entries (same id + same name once). */
export class EntrySet {
  private seen = new Set<string>(); readonly entries: SanctionsEntry[] = [];
  add(id: string, name: string, kind: string, programme: string, country: string) {
    const n = clean(name);
    if (!id || n.length < 2) return;
    const k = `${id}|${n.toLowerCase()}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.entries.push([id, n, clean(kind).toLowerCase() || "entity", clean(programme), clean(country)]);
  }
}

/** OFAC SDN.CSV (no header): ent_num, SDN_Name, SDN_Type, Program, … Entities have SDN_Type "-0-". */
export function ofacPrimary(rows: string[][], set: EntrySet, meta: Map<string, [string, string]>) {
  for (const r of rows) {
    const id = clean(r[0]); if (!/^\d+$/.test(id)) continue;
    const kind = clean(r[2]) || "entity", programme = clean(r[3]);
    meta.set(id, [kind, programme]);
    set.add(`SDN-${id}`, r[1], kind, programme, "");
  }
}
/** OFAC ALT.CSV (no header): ent_num, alt_num, alt_type, alt_name, remarks. */
export function ofacAliases(rows: string[][], set: EntrySet, meta: Map<string, [string, string]>) {
  for (const r of rows) {
    const id = clean(r[0]); if (!/^\d+$/.test(id)) continue;
    const [kind, programme] = meta.get(id) ?? ["entity", ""];
    set.add(`SDN-${id}`, r[3], kind, programme, "");
  }
}

/** Header-driven CSV (UK, EU): finds the header row by a required column, then maps each row through `pick`. */
export class HeaderCsv {
  private head: string[] | null = null;
  constructor(private required: string, private pick: (get: (col: string) => string, set: EntrySet) => void, private set: EntrySet) {}
  rows(rows: string[][]) {
    for (const r of rows) {
      if (!this.head) { if (r.some(c => c.replace(/^﻿/, "").trim() === this.required)) this.head = r.map(c => c.replace(/^﻿/, "").trim()); continue; }
      const ix = new Map(this.head.map((h, i) => [h, i]));
      this.pick(col => { const i = ix.get(col); return i === undefined ? "" : (r[i] ?? ""); }, this.set);
    }
  }
}

export const ukPick = (get: (c: string) => string, set: EntrySet) => {
  const name = ["Name 1", "Name 2", "Name 3", "Name 4", "Name 5", "Name 6"].map(get).map(s => s.trim()).filter(Boolean).join(" ");
  set.add(`UK-${get("Unique ID").trim()}`, name, get("Designation Type"), get("Regime Name"), get("Address Country"));
  const latin = get("Name non-latin script"); if (latin) set.add(`UK-${get("Unique ID").trim()}`, latin, get("Designation Type"), get("Regime Name"), get("Address Country"));
};
export const euPick = (get: (c: string) => string, set: EntrySet) => {
  const kind = get("Entity_SubjectType_ClassificationCode") === "person" ? "individual" : get("Entity_SubjectType_ClassificationCode") || "entity";
  set.add(`EU-${get("Entity_LogicalId").trim()}`, get("NameAlias_WholeName"), kind, get("Entity_Regulation_Programme"), get("Address_CountryDescription"));
};

const tag = (block: string, t: string) => [...block.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, "g"))].map(m => decodeXml(m[1]).trim()).filter(Boolean);
const decodeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** UN consolidated list XML: INDIVIDUAL and ENTITY blocks with names and aliases. */
export function unXml(xml: string, set: EntrySet) {
  for (const [kind, re] of [["individual", /<INDIVIDUAL>([\s\S]*?)<\/INDIVIDUAL>/g], ["entity", /<ENTITY>([\s\S]*?)<\/ENTITY>/g]] as const) {
    for (const m of xml.matchAll(re)) {
      const b = m[1];
      const id = `UN-${tag(b, "REFERENCE_NUMBER")[0] ?? tag(b, "DATAID")[0] ?? ""}`;
      const programme = tag(b, "UN_LIST_TYPE")[0] ?? "";
      const country = (b.match(/<NATIONALITY>\s*<VALUE>([^<]*)<\/VALUE>/)?.[1] ?? tag(b, "COUNTRY")[0] ?? "").trim();
      set.add(id, ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map(t => tag(b, t)[0] ?? "").filter(Boolean).join(" "), kind, programme, country);
      for (const a of tag(b, "ALIAS_NAME")) set.add(id, a, kind, programme, country);
    }
  }
}

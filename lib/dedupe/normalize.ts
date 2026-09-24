// Dedupe normalization (docs/plans/phase-1.md section 2e).

const LEGAL_SUFFIXES = [
  "s a de c v", "sa de cv", "s de rl de cv", "s a p i de c v", "sapi de cv", "s a", "sa", "s l", "sl", "s p a", "spa", "s r l", "srl",
  "ltda", "ltd", "limited", "llc", "l l c", "lp", "l p", "llp", "plc", "inc", "incorporated", "corp", "corporation", "co",
  "company", "gmbh", "ag", "kg", "bv", "b v", "nv", "n v", "ab", "as", "oy", "pty", "pte", "sas", "sarl", "kk", "holdings", "holding", "group",
];

const suffixRe = new RegExp(`(?:\\s(?:${LEGAL_SUFFIXES.map(s => s.replace(/ /g, "\\s")).join("|")}))+$`);

/** Lowercase, strip accents and punctuation, drop trailing legal suffixes and a leading "the". */
export function normalizeOrgName(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the\s+/, "");
  const stripped = base.replace(suffixRe, "").trim();
  return stripped || base;
}

export function normalizePersonName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.es", "yahoo.com.mx",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "yandex.com", "zoho.com", "qq.com", "163.com",
]);

export function isFreeMail(domain: string): boolean {
  return FREE_MAIL.has(domain.toLowerCase());
}

// Common two-part public suffixes so "foo.co.uk" stays "foo.co.uk" (not "co.uk").
const TWO_PART = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "com.br", "com.mx", "gob.mx", "co.za", "co.jp", "com.ar", "com.co", "co.in", "com.sg", "co.nz", "com.cn", "com.tr", "com.pe", "com.cl"]);

/** Registrable domain from a URL, host or email; null for free-mail providers. */
export function registrableDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  if (host.includes("@")) host = host.split("@").pop()!;
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\d?\./, "").replace(/\.$/, "");
  if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return null;
  const parts = host.split(".");
  const lastTwo = parts.slice(-2).join(".");
  const domain = TWO_PART.has(lastTwo) && parts.length >= 3 ? parts.slice(-3).join(".") : lastTwo;
  return isFreeMail(domain) ? null : domain;
}

/** Canonical LinkedIn profile URL: https://www.linkedin.com/in/<slug> */
export function canonicalLinkedin(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.trim().toLowerCase().match(/linkedin\.com\/(in|company)\/([^/?#]+)/);
  return m ? `https://www.linkedin.com/${m[1]}/${decodeURIComponent(m[2]).replace(/\/$/, "")}` : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

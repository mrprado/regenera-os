// House-style validator (SPEC section 25): hard fails for every outbound message.

export type StyleIssue = { rule: string; detail: string };

const GREENWASH = ["eco-friendly", "eco friendly", "green revolution", "save the planet", "100% sustainable", "planet-friendly", "guilt-free"];
const ROLE_BOUNDARY = [
  "committed capital", "we will raise", "guaranteed", "guarantee returns", "our investors", "our fund", "marketplace",
  "we manage your", "investment advice", "as your epc", "we are an epc", "broker-dealer services",
];
const SECURITIES = ["irr", "internal rate of return", "minimum investment", "carried interest", "preferred return", "fund terms", "subscription agreement"];

const hasWord = (text: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/**
 * Returns every violation; an empty list means the message may be approved.
 * `firstTouch` applies the 120-word limit; `advisory` blocks securities terms (advisory mandates).
 */
export function validateMessage(msg: { subject: string; body: string }, opts: { firstTouch: boolean; advisory: boolean }): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const text = `${msg.subject}\n${msg.body}`;
  if (/[–—]/.test(text)) issues.push({ rule: "no_dashes", detail: "Remove em and en dashes." });
  const bodyLines = msg.body.split("\n").filter(l => !/^\s*(https?:\/\/|\d{1,2}:\d{2})/.test(l));
  if (bodyLines.some(l => /;\s/.test(l))) issues.push({ rule: "no_semicolons", detail: "Use a full stop instead of a semicolon." });
  if (/\bncnda\b/i.test(text)) issues.push({ rule: "ncnda", detail: 'Write "confidentiality agreement", not NCNDA.' });
  for (const g of GREENWASH) if (hasWord(text, g)) issues.push({ rule: "greenwashing", detail: `Remove "${g}".` });
  if (/carbon neutral/i.test(text) && !/https?:\/\//.test(text)) issues.push({ rule: "greenwashing", detail: '"Carbon neutral" needs a source link or should be removed.' });
  for (const p of ROLE_BOUNDARY) if (hasWord(text, p)) issues.push({ rule: "role_boundary", detail: `Regenera does not claim "${p}" (Important Notice).` });
  if (opts.advisory) for (const s of SECURITIES) if (hasWord(text, s)) issues.push({ rule: "securities_terms", detail: `Remove "${s}" from advisory outreach.` });
  if (/!/.test(msg.body)) issues.push({ rule: "no_exclamation", detail: "No exclamation marks." });
  if (/respond within|reply within \d|we will respond in/i.test(text)) issues.push({ rule: "commitments", detail: "No response-time commitments." });
  if (opts.firstTouch && wordCount(msg.body) > 120) issues.push({ rule: "length", detail: `First touch is ${wordCount(msg.body)} words; keep it to 120 or fewer.` });
  return issues;
}

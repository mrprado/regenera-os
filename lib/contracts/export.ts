// Contract downloads: Word-compatible .doc files (HTML that Word, Google Docs and Pages open) and a zip of
// every blank template for counsel. All text is HTML-escaped before the small Markdown subset is applied.
import { strToU8, zipSync } from "fflate";
import type { ContractTerms } from "@/db/contracts";
import { ENGAGEMENTS } from "@/lib/vocab";
import { CONTRACT_KIND_LABEL, renderContract, type ContractKind, type EngagementKey } from "./templates";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

/** The Markdown subset the templates use (#, ##, **bold**, "- " lists, "> " notes), as escaped HTML. */
export function markdownToHtml(md: string) {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; }
    if (list.length) { out.push(`<ul>${list.map(l => `<li>${inline(l)}</li>`).join("")}</ul>`); list = []; }
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const t = raw.trimEnd();
    if (!t.trim()) { flush(); continue; }
    if (t.startsWith("# ")) { flush(); out.push(`<h1>${inline(t.slice(2))}</h1>`); continue; }
    if (t.startsWith("## ")) { flush(); out.push(`<h2>${inline(t.slice(3))}</h2>`); continue; }
    if (t.startsWith("> ")) { flush(); out.push(`<p class="note">${inline(t.slice(2))}</p>`); continue; }
    if (t.startsWith("- ")) { if (para.length) flush(); list.push(t.slice(2)); continue; }
    if (list.length) flush();
    para.push(t);
  }
  flush();
  return out.join("\n");
}

export function wordDoc(title: string, md: string) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:"Helvetica Neue",Arial,sans-serif;font-size:11pt;line-height:1.5}h1{font-size:18pt}h2{font-size:12pt;margin-top:14pt}.note{border-left:3pt solid #d9b64a;padding-left:8pt;color:#555}</style>
</head><body>
${markdownToHtml(md)}
</body></html>`;
}

export const safeFileName = (s: string) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "contract";

// Blank templates: named brackets instead of [TO CONFIRM], so counsel sees what each blank is for.
const BLANK_TERMS: ContractTerms = {
  currency: "[CURRENCY]",
  feeSummary: "[FEES: amount, basis and invoicing schedule]",
  paymentDays: 30,
  termMonths: null,
  noticeDays: 30,
  autoRenew: false,
  governingLaw: "[GOVERNING LAW]",
  counterparty: { name: "[CLIENT NAME]", address: "[CLIENT ADDRESS]", signatoryName: "[SIGNATORY NAME]", signatoryTitle: "[SIGNATORY TITLE]", signatoryEmail: "" },
  regenera: { signatoryName: "[REGENERA SIGNATORY]", signatoryTitle: "[TITLE]" },
};

export type TemplateFile = { key: string; group: string; name: string; fileName: string; body: string };

/** Every blank template: an engagement letter and a SOW per engagement, plus NDA, referral agreement and amendment. */
export function templateLibrary(): TemplateFile[] {
  const files: TemplateFile[] = [];
  const add = (kind: ContractKind, engagement: EngagementKey, group: string, name: string, feeType: "one_time" | "success_fee" = "one_time", terms = BLANK_TERMS) => {
    const body = renderContract({ kind, engagement, feeType, project: "[PROJECT]", terms, effectiveDate: "[START DATE]", today: "[DATE]" });
    files.push({ key: `${kind}${kind === "engagement_letter" || kind === "sow" ? `-${engagement}` : ""}`, group, name, fileName: `${safeFileName(`Regenera ${name}`)}.doc`, body });
  };
  for (const e of Object.keys(ENGAGEMENTS) as EngagementKey[]) {
    // Capital work carries the success-fee clause so counsel reviews it once.
    const fee = e === "capital_advisory" || e === "capital_screening" ? "success_fee" : "one_time";
    add("engagement_letter", e, "Engagement letters", `${CONTRACT_KIND_LABEL.engagement_letter} - ${ENGAGEMENTS[e]}`, fee);
  }
  for (const e of Object.keys(ENGAGEMENTS) as EngagementKey[]) add("sow", e, "Statements of work", `${CONTRACT_KIND_LABEL.sow} - ${ENGAGEMENTS[e]}`);
  add("nda", "diagnostic", "Other agreements", CONTRACT_KIND_LABEL.nda, "one_time", { ...BLANK_TERMS, termMonths: 24 });
  add("referral_agreement", "diagnostic", "Other agreements", CONTRACT_KIND_LABEL.referral_agreement, "one_time", { ...BLANK_TERMS, feeSummary: "[10% / 15% / 20% by partner tier]" });
  add("amendment", "diagnostic", "Other agreements", CONTRACT_KIND_LABEL.amendment);
  return files;
}

export function templatesZip(files = templateLibrary()) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.fileName] = strToU8(wordDoc(f.name, f.body));
  entries["README.txt"] = strToU8(`Regenera contract templates\n\nStarting points for counsel, not legal advice. Bracketed items ([CLIENT NAME], [FEES] and so on) are blanks to fill.\nThe engagement letters for capital advisory and capital screening include the success-fee clause, marked [COUNSEL REVIEW REQUIRED].\nOpen the .doc files in Word, Google Docs or Pages.\n`);
  return zipSync(entries);
}

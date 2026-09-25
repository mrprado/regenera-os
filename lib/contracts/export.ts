// Contract downloads as PDFs in Regenera's house style (lib/contracts/pdf.ts): one contract, one blank template,
// or a zip of every blank template for counsel.
import { strToU8, zipSync } from "fflate";
import type { ContractTerms } from "@/db/contracts";
import { ENGAGEMENTS } from "@/lib/vocab";
import { contractPdf } from "./pdf";
import { CONTRACT_KIND_LABEL, renderContract, type ContractKind, type EngagementKey } from "./templates";

export const safeFileName = (s: string) => s.replace(/[^\w\- ]+/g, "").trim().replace(/[\s-]+/g, "-").slice(0, 80) || "contract";

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
    files.push({ key: `${kind}${kind === "engagement_letter" || kind === "sow" ? `-${engagement}` : ""}`, group, name, fileName: `${safeFileName(`Regenera ${name}`)}.pdf`, body });
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

export const templatePdf = (f: TemplateFile, today: string) =>
  contractPdf(f.body, { kicker: "Template for counsel review", shortTitle: f.name, status: "Template", date: today });

export async function templatesZip(today = new Date().toISOString().slice(0, 10), files = templateLibrary()) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.fileName] = await templatePdf(f, today);
  entries["README.txt"] = strToU8(`Regenera contract templates

Starting points for counsel, not legal advice. Bracketed items ([CLIENT NAME], [FEES] and so on) are blanks to fill.
The engagement letters for capital advisory and capital screening include the success-fee clause, marked [COUNSEL REVIEW REQUIRED].
`);
  return zipSync(entries);
}

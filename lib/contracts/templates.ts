// Contract templates (docs/plans/phase-5.md part E). Starting points only: every template says it needs review by
// counsel before use. Placeholders are {{name}}; anything missing renders as [TO CONFIRM] so gaps stay visible.
import type { ContractTerms } from "@/db/contracts";
import { ENGAGEMENTS, FEE_TYPES } from "@/lib/vocab";

export const CONTRACT_KIND_LABEL = {
  engagement_letter: "Engagement letter",
  sow: "Statement of work",
  nda: "Mutual NDA",
  referral_agreement: "Partner referral agreement",
  amendment: "Amendment",
} as const;
export type ContractKind = keyof typeof CONTRACT_KIND_LABEL;
export type EngagementKey = keyof typeof ENGAGEMENTS;

export const TO_CONFIRM = "[TO CONFIRM]";

/** Default scope and deliverables per engagement. Edit to the actual engagement before sending. */
export const ENGAGEMENT_SCOPE: Record<EngagementKey, { scope: string; deliverables: string[] }> = {
  diagnostic: {
    scope: "An assessment of the Project across its territorial systems: site and resource conditions, permitting and stakeholder position, technical and commercial readiness, key risks, and realistic capital pathways.",
    deliverables: ["Diagnostic report with findings by territorial system", "Readiness assessment and risk register", "Recommended next steps and development roadmap"],
  },
  capital_screening: {
    scope: "A screening of potential capital partners against the Project's profile, stage and needs, producing a shortlist with the reasons for fit. Screening does not include soliciting, marketing or offering any security.",
    deliverables: ["Capital-partner long list and screening criteria", "Shortlist with fit rationale", "Recommendations on approach and sequencing"],
  },
  readiness_mandate: {
    scope: "Work to close the readiness gaps identified for the Project, coordinating the studies, documentation and counterparties needed to reach a defined readiness milestone.",
    deliverables: ["Readiness plan with milestones", "Coordinated studies and documentation", "Data room structure and index", "Readiness milestone report"],
  },
  development_office: {
    scope: "An ongoing development office for the Project: coordination of workstreams, consultants and stakeholders, governance support and regular reporting.",
    deliverables: ["Workstream plan and coordination", "Monthly progress report", "Stakeholder and decision log", "Governance meeting support"],
  },
  capital_advisory: {
    scope: "Strategic advice on the Project's capital strategy and materials, mapping of suitable capital partners, and introductions only after fit, authority and disclosure have been confirmed with both sides.",
    deliverables: ["Capital strategy memo", "Review of investor-facing materials", "Capital-partner map", "Introductions log (only after confirmation of fit, authority and disclosure)"],
  },
  governance_monitoring: {
    scope: "Design and operation of governance and monitoring for the Project: indicators, data collection, verification of progress and periodic reporting to the Client and agreed stakeholders.",
    deliverables: ["Monitoring framework and indicators", "Periodic monitoring reports", "Governance recommendations"],
  },
};

const IMPORTANT_NOTICE = `Regenera provides advisory and development-office services. Regenera is not a broker-dealer, investment adviser, fund, lender, placement agent or engineering, procurement and construction (EPC) contractor, and does not operate a public marketplace. Regenera does not solicit, offer or sell securities, does not hold or handle investor or client funds, and does not give legal, tax or investment advice. Any introduction happens only after fit, authority and disclosure have been confirmed with both parties. The Client makes its own decisions and takes its own professional advice.`;

const HEADER = `> Template: review by counsel is required before this document is sent. It is a starting point, not legal advice. Remove this note before sending.`;

const SIGNATURES = `## Signatures

**Regenera**
Name: {{regenera_signatory}}
Title: {{regenera_title}}
Signature: ______________________  Date: __________

**{{client_name}}**
Name: {{client_signatory}}
Title: {{client_title}}
Signature: ______________________  Date: __________`;

const TEMPLATES: Record<ContractKind, string> = {
  engagement_letter: `${HEADER}

# Engagement letter: {{engagement_label}}

**Date:** {{date}}
**Between:** Regenera ("Regenera") and {{client_name}}, {{client_address}} (the "Client")
**Project:** {{project}}

## 1. Scope
{{scope}}

## 2. Deliverables
{{deliverables}}

## 3. Term
This engagement starts on {{effective_date}} and {{term_text}}.

## 4. Fees and payment
{{fee_summary}}

Invoices are payable within {{payment_days}} days in {{currency}}. Pre-approved third-party costs are billed at cost.
{{success_fee_clause}}

## 5. What Regenera is not
${IMPORTANT_NOTICE}

## 6. Client responsibilities
The Client provides timely access to information, sites and decision makers, confirms that the information it provides is accurate to its knowledge, and remains responsible for its own decisions, filings and approvals.

## 7. Confidentiality
Each party keeps the other's confidential information confidential, uses it only for this engagement, and shares it only with advisers bound by similar duties, or as required by law. This survives for three years after the engagement ends.

## 8. Intellectual property
Once paid, the Client owns the deliverables prepared for it. Regenera keeps its methods, tools, templates and general know-how, and may use anonymized learnings. Regenera does not name the Client or the Project publicly without written consent.

## 9. Data protection
Each party handles personal data under the laws that apply to it and only for this engagement.

## 10. Liability
Regenera's total liability under this engagement is limited to the fees paid to it in the twelve months before the claim. Neither party is liable for indirect or consequential loss. Nothing limits liability that cannot be limited by law.

## 11. Termination
Either party may end this engagement with {{notice_days}} days' written notice. The Client pays for work done up to the end date.

## 12. Governing law
This engagement is governed by the laws of {{governing_law}}.

${SIGNATURES}`,

  sow: `${HEADER}

# Statement of work: {{engagement_label}}

**Date:** {{date}}
**Under:** the agreement between Regenera and {{client_name}} (the "Client")
**Project:** {{project}}

## Scope
{{scope}}

## Deliverables
{{deliverables}}

## Timing
Starts {{effective_date}}; {{term_text}}.

## Fees
{{fee_summary}}
Invoices are payable within {{payment_days}} days in {{currency}}.
{{success_fee_clause}}

All other terms of the agreement between the parties apply.

${SIGNATURES}`,

  nda: `${HEADER}

# Mutual non-disclosure agreement

**Date:** {{date}}
**Between:** Regenera and {{client_name}}, {{client_address}}
**Purpose:** discussing a possible engagement concerning {{project}}.

1. Each party may share confidential information for the Purpose only.
2. The receiving party keeps it confidential, uses it only for the Purpose, and shares it only with people who need it and are bound by similar duties.
3. This does not cover information that is public, already known, independently developed, or lawfully received from someone else.
4. Either party may be required by law to disclose; it will give notice where allowed.
5. Nothing here creates an obligation to enter any transaction. ${IMPORTANT_NOTICE}
6. Obligations last {{term_years}} years from the date above. On request, each party returns or destroys the other's confidential information.
7. Governed by the laws of {{governing_law}}.

${SIGNATURES}`,

  referral_agreement: `${HEADER}

# Partner referral agreement

**Date:** {{date}}
**Between:** Regenera and {{client_name}}, {{client_address}} (the "Partner")

1. **Referrals.** The Partner may introduce organizations to Regenera for its advisory and development-office services. The Partner makes introductions only with the referred organization's consent.
2. **Referral fee.** When a referred organization signs an engagement with Regenera within twelve months of the introduction, Regenera pays the Partner {{fee_summary}} of the professional fees Regenera receives under that engagement, within {{payment_days}} days of receiving them.
3. **No capital-raising fees.** No fee is paid on any investment, loan or capital raised. The Partner does not act for Regenera in soliciting investors.
4. **Independence.** The Partner is independent, does not represent or bind Regenera, and makes no promises about Regenera's services or outcomes.
5. **Confidentiality.** Each party keeps the other's confidential information confidential.
6. **Term.** This agreement runs until either party ends it with {{notice_days}} days' written notice. Fees earned before the end remain payable.
7. **Governing law.** {{governing_law}}.

${SIGNATURES}`,

  amendment: `${HEADER}

# Amendment

**Date:** {{date}}
**To:** the agreement between Regenera and {{client_name}} concerning {{project}}

The parties agree to change the agreement as follows:

1. ${TO_CONFIRM}

All other terms stay the same.

${SIGNATURES}`,
};

export type TemplateInput = {
  kind: ContractKind;
  engagement: EngagementKey;
  feeType: keyof typeof FEE_TYPES;
  project: string;
  terms: ContractTerms;
  effectiveDate: string | null;
  today: string;
};

const needsCounsel = (feeType: string, engagement: string) =>
  feeType === "success_fee" || feeType === "fee_plus_equity" || engagement === "capital_advisory" || engagement === "capital_screening";

export function counselRequired(input: { kind: ContractKind; feeType: string; engagement: string; mandateType?: string }) {
  if (input.kind === "nda" || input.kind === "referral_agreement") return input.mandateType === "investment";
  return input.mandateType === "investment" || needsCounsel(input.feeType, input.engagement);
}

/** Plain-language fee terms from a deal's fee type and tracker terms (flatFee, monthly, percentage, equity, dealSize). */
export function feeSummary(feeType: keyof typeof FEE_TYPES, t: Record<string, string>, currency: string) {
  const money = (v?: string) => (v ? `${currency} ${v}` : TO_CONFIRM);
  switch (feeType) {
    case "one_time": return `A fixed fee of ${money(t.flatFee)}, invoiced ${TO_CONFIRM} (for example 50% at signing, 50% on delivery).`;
    case "monthly_retainer": return `A monthly retainer of ${money(t.monthly)}, invoiced monthly in advance.`;
    case "milestone": return `Fees by milestone, as set out in the milestone schedule: total ${money(t.flatFee)}.`;
    case "fee_plus_equity": return `A fee of ${money(t.flatFee || t.monthly)} plus equity of ${t.equity || TO_CONFIRM} in ${TO_CONFIRM}, on terms to be documented separately.`;
    case "success_fee": return `A fee of ${money(t.flatFee || t.monthly)}${t.percentage ? `, plus a success fee of ${t.percentage}` : ""}, as described in the success-fee clause.`;
  }
}

const SUCCESS_FEE_CLAUSE = `
**Success fee [COUNSEL REVIEW REQUIRED].** Any success or deal-based fee is payable only for advisory and development-office work, is never calculated on or paid from investor funds, and applies only where counsel has confirmed it is permitted for Regenera in the relevant jurisdictions. Details: ${TO_CONFIRM}.`;

// Placeholders that may legitimately be empty (the clause does not apply).
const OPTIONAL = new Set(["success_fee_clause"]);

export function renderContract(input: TemplateInput): string {
  const { terms } = input;
  const scope = ENGAGEMENT_SCOPE[input.engagement];
  const vars: Record<string, string> = {
    date: input.today,
    engagement_label: ENGAGEMENTS[input.engagement],
    client_name: terms.counterparty.name,
    client_address: terms.counterparty.address,
    client_signatory: terms.counterparty.signatoryName,
    client_title: terms.counterparty.signatoryTitle,
    regenera_signatory: terms.regenera.signatoryName,
    regenera_title: terms.regenera.signatoryTitle,
    project: input.project,
    scope: scope.scope,
    deliverables: scope.deliverables.map(d => `- ${d}`).join("\n"),
    effective_date: input.effectiveDate ?? "",
    term_text: terms.termMonths ? `runs for ${terms.termMonths} months${terms.autoRenew ? `, renewing for the same period unless either party gives ${terms.noticeDays} days' notice before it ends` : ""}` : "runs until the scope above is complete",
    term_years: String(Math.max(1, Math.round((terms.termMonths ?? 24) / 12))),
    fee_summary: terms.feeSummary,
    payment_days: String(terms.paymentDays),
    currency: terms.currency,
    notice_days: String(terms.noticeDays),
    governing_law: terms.governingLaw,
    success_fee_clause: input.feeType === "success_fee" || input.feeType === "fee_plus_equity" ? SUCCESS_FEE_CLAUSE : "",
  };
  return TEMPLATES[input.kind].replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars[k]?.trim() ? vars[k] : OPTIONAL.has(k) ? "" : TO_CONFIRM));
}

/** Gaps still marked [TO CONFIRM], counted so a contract cannot be sent with them unnoticed. */
export const openGaps = (body: string) => body.split(TO_CONFIRM).length - 1;

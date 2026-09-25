# Regulatory model

Canonical spec: docs/master-spec.md parts XX, XLIV–XLVIII. Code: lib/regulatory/*, app/(app)/projects/regulatory-tab.tsx,
app/(app)/regulatory/reviews-panel.tsx, the capital gate (docs/capital-model.md).

## Principles
- The OS never states that anything is compliant. It records who concluded what, when, on what evidence, with what
  conditions and until when.
- Three separate tracks: **project regulation** (host-country permission to build and operate), **lender and
  investor standards** (IFC Performance Standards, IFC/WBG EHS Guidelines, World Bank ESF, Equator Principles, DFI and
  lender requirements) and **capital regulation** (offering exemptions, solicitation, financial promotion,
  intermediary activity, compensation, KYC/AML, sanctions, cross-border marketing).
- No autonomous regulated outreach (see the compliance gate).

## Built (M4)
- **Jurisdiction matrix** (`project_jurisdictions`): project site, ProjectCo, sponsor, Regenera entity, investor,
  lender, issuer, EPC, equipment origin, offtaker, each with ISO 3166 codes.
- **Requirements** (`requirements`): track, domain (26 project-regulation domains plus lender E&S and other lender
  requirements), title, jurisdiction, authority, status (Unknown, Researching, Applicable, Not applicable, Counsel
  review, Required, Submitted, Approved, Expired), source and source tier (1–5), owner, reviewer, evidence, next
  verification. Approved and Not applicable need evidence and a reviewer. One click seeds IFC PS (8), World Bank ESF
  (10), Equator Principles (10) or the EHS Guidelines as Unknown items on the lender track.
- **Permits** (`permits`): authority, jurisdiction, reference, status, submitted/approved/expiry dates, conditions,
  owner, document. Approved needs an approval date. A daily job marks approved permits past expiry as Expired.
- **Reviews** (`regulatory_reviews`) on projects, capital opportunities, contracts, introductions or outreach: topic,
  jurisdiction, conclusion (permitted, permitted with conditions, not permitted, further review), conditions,
  reviewer, reviewer role, date, evidence, valid until. Owners record them; conditional conclusions need conditions.
- **KYC / AML status** (`kyc_checks`, owner-only): entity verification, beneficial ownership, sanctions, PEP, AML,
  source of funds, NDA, data room; provider, status, reference and dates, never identity documents. Never exposed to
  Ask the OS or MCP (tested).
- **Today**: permits expiring within 90 days or expired, requirements due for re-verification, requirements in
  counsel review.

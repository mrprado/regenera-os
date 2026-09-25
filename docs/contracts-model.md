# Contracts and documents model

Canonical spec: docs/master-spec.md parts XLIX–LIII. Code: lib/contracts/* (catalog, templates, engine, register,
pdf, export), app/(app)/contracts/*, app/(app)/documents.

## Two ways a contract enters the OS
1. **Regenera's own contracts (templates):** engagement letters, SOWs, NDAs, referral agreements and amendments drafted
   from a deal or partner (phase 5 part E). Counsel review is required for success fees, equity, capital work and
   investment mandates; gaps and the template note block sending.
2. **Registered agreements:** every other agreement in the catalog (corporate, land, development, energy and
   commercial, engineering, procurement and construction, operations, financing, equity, bonds and notes,
   environmental and community, insurance). The OS records type, project, parties, governing law, forum, execution,
   effective and expiry dates, renewal terms, value, a summary and key terms (conditions precedent and subsequent,
   representations, covenants, reporting, deliverables, performance, payment terms, insurance, security, guarantees,
   indemnities, liability cap, liquidated damages, termination, defaults, change control, assignment,
   confidentiality, dispute resolution, notices) and links the executed document. It organizes and flags; it does
   not interpret or replace counsel.

## Lifecycle and locking
Draft, internal review, counterparty review, legal review, negotiation, approved, out for signature, effective,
active, amended, renewal, expired, terminated, archived. Reaching an executed state locks the recorded text and key
terms; an executed agreement cannot return to a pre-execution state. Changes are registered as amendments linked to
the original, which becomes Amended. Every change is a version in `contract_versions`. Template contracts keep their
own status and now also carry the matching lifecycle (sent → out for signature, signed → active and locked).

## Obligations
`contract_obligations`: responsible party, obligation, category (payment, reporting, notice, CP, CS, covenant,
deliverable, milestone, insurance, E&S, permit, renewal, performance, other), due date, recurrence (monthly,
quarterly, six-monthly, annual), evidence required, owner, status, completion evidence, source clause, risk if missed.
Completing an obligation that requires evidence needs the evidence; a recurring obligation creates its next
occurrence. Today and the daily digest show obligations due within 14 days or overdue, registered agreements expiring
within 90 days, and agreements waiting for a compensation review (capital advisory, success fee, referral types).

## Documents
`documents` is a registry (title, category, version, status, confidentiality, owner, project, counterparty, approval,
effective and expiry dates, link or R2 key) and `document_links` attach a document to any record. A new version
supersedes the previous one, which is kept. Storage is a link (Drive, data room) until R2 is enabled.

## Exports
PDF of any Regenera contract; a contract abstract PDF for registered agreements (clearly labelled as not the executed
document); contract register and obligation register as CSV (`/api/contracts/register?type=contracts|obligations`).

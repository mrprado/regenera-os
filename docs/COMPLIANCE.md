# Compliance

Compliance in Regenera OS is issue spotting, requirement tracking, evidence management and approval routing — not
legal advice. Nothing is ever labelled "compliant" by the system.

| Area | Where | What it does |
|---|---|---|
| Regulatory requirements and permits | Project → Regulatory; docs/regulatory-model.md | Host-law vs lender standards (IFC PS, WB ESF, Equator, IFC EHS), statuses from Potential requirement to Verified/Counsel review, reviewer and evidence, re-verification dates, permit expiry alerts |
| Investor eligibility | Capital → private profiles and qualifications (owner-only) | Jurisdiction-, rule- and time-specific qualifications with evidence and expiry; never a global "accredited" label |
| Capital communications | Compliance gate at send time (lib/crm/send.ts) | Gated messages need an approved opportunity gate, an approved recipient match, eligibility where required and approved materials |
| Portal distribution | Portals → Distribution | Audience, jurisdiction, dates, securities-related flag; every open and denial logged |
| Introducers | Portals → Introducers | Role is a label, not authority; licence verification with evidence; conflict review; commissions estimated until agreement + legal review approved |
| KYC / sanctions | Owner-only KYC records | Status, provider, reviewer; no sanctions provider is faked |
| E&S | Project → Risk & E&S | Issues judged against a named framework; mitigation hierarchy |
| Engineering | Project → Engineering | Codes "confirmed by engineer of record" with the name; never certified |
| Legal documents | Documents → Generator | DRAFT — COUNSEL REVIEW REQUIRED until an owner records counsel's approval |
| Stage gates | Notifications → Stage gates | Evidence checks; owner override with an audited reason |
| Privacy | Settings, privacy requests | Export/delete workflow; intake privacy notice; IPs hashed |

Success fees, securities-related compensation and investment mandates require compliance/counsel review by default.

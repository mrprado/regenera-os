# Permissions

Current roles per entity (`mandate_members.role`): **owner** and **member**.

| Capability | Member | Owner |
|---|---|---|
| Projects, readiness, constraints, capital requirements, tranches, capital opportunities, matching, ledger | Yes | Yes |
| Contracts, obligations, documents, requirements, permits | Yes | Yes |
| Private investor profiles, investor qualifications, KYC status | No | Yes |
| Compliance gate decisions, regulatory reviews, contract counsel/compensation reviews | No | Yes |
| Integration feature states, entity settings, members | No | Yes |

Planned (master spec LXXIX): Admin, Partner, Project Developer, Capital, Origination, Analyst, Technical, Compliance,
Advisor, read-only and external roles. The owner/member split already separates the sensitive capabilities;
finer roles map onto it without data changes.

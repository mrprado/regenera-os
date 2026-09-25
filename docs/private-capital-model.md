# Private capital model

Canonical spec: docs/master-spec.md parts XXVII–XXXI, LXXX. Built in M2.

- **Person ≠ classification.** A person may have one `private_capital_profiles` row (per entity) and any number of
  `investor_qualifications`. The OS never labels anyone "accredited", "sophisticated", "professional" or "HNW" in
  general: a qualification is jurisdiction-, rule- and time-specific, with status (Unknown, Unassessed, Assessment
  required, Self-certified where legally valid, Third-party verified, Professionally verified, Expired, Not
  eligible), method, verifier, dates, restrictions and an evidence *reference* (never the document).
- **Only what is known.** Profiles record stated interests (sectors, geographies, asset classes, stages,
  instruments, indicative ticket, horizon, income/growth preference, development/construction/operating appetite,
  explicitly stated risk appetite, constraints). Unknown stays Unknown; no wealth information is collected.
- **Journey:** Identified … Funded, Active investor, Reporting, Maturity/exit (21 stages); stage changes are audited
  with a reason. Interest, IOI, soft circle, commitment, subscription and funding live in the commitment ledger.
- **Protection:** private profiles and qualifications are **owner-only** (members see "Private investor (owner
  only)" in matches), never exposed to Ask the OS or the MCP server (a test enforces this), and every write is
  audited.

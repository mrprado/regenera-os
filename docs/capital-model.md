# Capital model

Canonical spec: docs/master-spec.md parts XXIII–XXXVII. Built so far: project capital requirements and tranches (M1).
Next: capital profiles, investor mandates, private capital profiles, investor qualifications, capital opportunities,
matches, commitment ledger, compliance gate (M2).

## Requirements, not "seeking $X"
A project's capital need is a set of `capital_requirements`, one per purpose and instrument (pre-development,
development, sponsor equity, preferred/project equity, senior debt, mezzanine, catalytic …), each with target,
minimum, maximum, currency, stage, target close, use of funds, economics, term, security, seniority, repayment,
exit/refinance and regulatory status. Instruments: the catalog of part XXIII (lib/projects/vocab.ts INSTRUMENTS).

## Tranches
A requirement can be offered as several `capital_tranches` (for example by investor type or ticket), each with
instrument, target, minimum and maximum participation, economics, seniority, security, eligibility and target investor
type. Tranches never add to totals: totals are computed from requirements only, so nothing is counted twice.

## Totals and "capital needed now"
Per currency: target (live requirements), secured (capped at target), and needed within 180 days = the open gap of
requirements whose target close falls in the next 180 days and are not closed. Cancelled requirements are excluded.
`secured` is a single amount in M1; M2 replaces it with the commitment ledger (conversation, interest, IOI, soft
circle, commitment, subscription, funded).

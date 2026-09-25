# Capital model

Canonical spec: docs/master-spec.md parts XXIII–XXXVII. Built: project capital requirements and tranches (M1); capital
partners and their mandates, capital opportunities, matching, the commitment ledger, capital formation, material
deliveries, introductions, bonds and notes, and the compliance gate (M2). Private capital: docs/private-capital-model.md.

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

## Capital partners and mandates (M2)
`capital_profiles`: funds, family offices, DFIs, banks, foundations, strategics, governments, green banks, ECAs, with
criteria (geographies, sectors, stages, instruments, ticket range, currency), risk, return, tenor, impact, E&S and
lender standards, local content, relationship strength, next action, source and last verified. A partner can hold
several `capital_mandates` (the investor's own mandates, with validity dates); matching uses the best active one.
The word "mandate" in the header switcher now reads **Entity** (Regenera, RA-ESG, GWCe) to avoid confusion.

## Capital opportunities (the bridge between project and capital)
`capital_opportunities` offer one requirement or tranche: instrument, target, offering, offering jurisdictions,
issuer, sponsor, arranger, placement party, counsel, financial advisor, Regenera's role (default "Not a party to the
offering"), approved materials with versions, gate state with reviewer, evidence and conditions.

## Matching: commercial alignment vs regulatory eligibility
`capital_matches` store both, separately, with reasons. Commercial fit (0–100): geography 25 (regions such as LATAM
expand to countries), sector 20, stage 15, instrument 20, ticket 20. Unknown criteria score nothing and cost nothing.
Regulatory eligibility comes only from `investor_qualifications` for the offering's jurisdictions, unexpired and in a
qualifying status; institutions without a record show "Not assessed". Eligibility on record is not a legal
conclusion.

## Commitment ledger and capital formation
`commitments` hold one current row per investor per opportunity (conversation, interest, IOI, soft circle,
commitment, executed subscription, funded, withdrawn); `commitment_events` keep the history. Commitment and later
stages need evidence. Formation counts each investor once at its current stage: target, identified, shortlisted,
approved for outreach, interested, IOI, committed, funded.

## Compliance gate
Gate states: Review required (default), Hold, Clear, Approved, Not permitted. Approved, Clear and Not permitted need a
named reviewer and evidence. Changing offering jurisdictions, the offering text or materials returns an approved
gate to Review required. Investors can be approved for outreach only when the gate is Approved and they are not
recorded as not eligible. At send time (`lib/crm/send.ts`), any message typed as investment communication,
financial promotion or approved offering communication, or linked to a capital opportunity, is held and returned to
the approval queue unless: the gate is Approved, the recipient is approved for outreach on that opportunity, private
recipients have eligibility on record, and approved materials exist. Sent gated emails record a material delivery
per approved material version. A daily job (`capital.expire`) expires qualifications past their date, which holds
outreach to those investors.

## Introductions and bonds
`introductions` record introducer, recipient, context, project and status; any compensation flags
COMPENSATION / REGULATORY REVIEW REQUIRED until an owner records the review. `debt_securities` hold bond and note
programs (issuer, size, denomination, coupon, maturity, trustee, arranger, placement agent, counsel, jurisdictions,
restrictions, eligible recipients); issuers are data, so RA-ESG and third parties share one model.

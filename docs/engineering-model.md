# Engineering, delivery and economics model

Built in phase 6 M7–M8 (docs/plans/phase-6.md). Master spec parts XVI (engineering), XX (E&S), XXI–XXII
(commercial and economics), LX (insurance) and roadmap step 4 (milestones, critical path, decisions).

## Plan: milestones, critical path, decisions (db/delivery.ts, lib/delivery/cpm.ts)
- `project_milestones`: name, category, **duration_days** (work needed once dependencies are done), **due_date**
  (committed or contractual), **depends_on** (milestone ids in the same project), status, owner, evidence (e.g. "PPA
  clause 7.2"), optional links to a contract, obligation or constraint, `is_target` for financial close / COD.
- Critical path (`criticalPath`): forward pass from today (done milestones finish on their completion date), backward
  pass from the latest finish; zero slack = critical. Each milestone gets a forecast finish, slack, days late against
  its due date, and overdue. Cycles are detected and refused when dependencies are edited.
- `decisions`: the decision log (context, options, decision, rationale, decided by/at, evidence, needed-by date).
- Today → Delivery: milestones overdue, forecast late on the critical path or due within 14 days; decisions needed
  within 7 days.

## Engineering (db/delivery.ts)
- `studies`: 14 study types (survey, topography, geotechnical, hydrology, flood, seismic, resource, grid,
  traffic/logistics, sector, ESIA, biodiversity, market, other), status from not started to accepted, provider, cost,
  findings, reviewer. Accepting needs the reviewer's name.
- `CORE_STUDIES` (lib/delivery/vocab.ts) lists the studies expected per asset class (plus ESIA from Development). From
  Development onward, missing ones appear on Today as "missing engineering information". This is a screening
  checklist, not an engineering scope.
- `design_packages`: stage (concept → as-built) × discipline, status; "approved" needs the engineer of record's name.
- `engineering_requirements`: code or standard, version, jurisdiction, authority, source, effective date, last
  verified, reviewer; status Identified / Applies / Confirmed by engineer of record / Not applicable / To verify.
  The OS records who confirmed; it never certifies compliance.

## Environmental and social, insurance
- `es_issues`: 22 topics, the framework the issue is judged against (host law vs IFC PS, IFC EHS, WB ESF, Equator,
  other lender), reference, severity, mitigation-hierarchy step (avoid, minimize, restore, offset), owner, due,
  evidence, status. Open high/critical issues appear on Today.
- `insurance_policies`: 12 cover types, phase, status (required, quoting, bound, lapsed, not required), insurer,
  broker, limit, deductible, premium, dates, the requirement that imposes it. Today: bound covers expiring in 60
  days, lapsed covers, and covers required for construction but not bound once a project is in construction.

## Commercial and economics (db/economics.ts, lib/economics/*)
- `revenue_streams`: mechanism (PPA, offtake, tolling, concession, feedstock, tipping fee, lease, product sale,
  availability, environmental credit, merchant, other), counterparty, price × volume, currency, escalation,
  indexation, tenor, counterparty credit, payment security, termination, status. Year-1 revenue in the project
  currency prefills a new case; other currencies are listed, never converted silently.
- `economic_cases`: inputs (CAPEX, materials share, construction months, COD delay, life, revenue, escalation,
  yield vs P50, degradation, FX loss, carbon volume and price, OPEX, gearing, interest, tenor, target DSCR, tax,
  discount rate) and stored outputs.
- Model (`runCase`): annual periods; CAPEX at financial close; revenue from COD; tax on EBITDA less straight-line
  depreciation (no interest shield, conservative); debt sculpted to CFADS / target DSCR over the tenor, capped by
  gearing; project and equity IRR, NPV, min/avg DSCR, LLCR, payback.
- Scenarios: saving a base case derives Downside (CAPEX +15%, COD +6 months, interest +1.5 pp, yield −10%, OPEX +10%)
  and Upside (CAPEX −5%, yield +5%, interest −0.5 pp); they refresh when the base case changes.
- Sensitivities: CAPEX, COD delay, interest, FX, yield, revenue price, material cost, carbon price, OPEX; equity IRR
  and minimum DSCR at each end, widest swing first.
- Boundary (shown on the page and in the brief): an indicative screening model, not a bankable financial model.

## Where it surfaces
Project tabs Plan, Engineering, Risk & E&S, Economics; Today → Delivery; the project brief PDF (plan, engineering,
E&S, insurance, economics); Ask the OS tool `project_delivery`.

## Not built yet
Materials/BoQ/EPD and circularity, procurement pipeline and bids, supply chain, EPC network matching, construction
control tower and operations. They get their own plan when projects reach those stages.

# Materials, procurement and network model

Built in phase 6 M9 (docs/plans/phase-6.md). Master spec parts XVII–XIX (materials, circularity, embodied carbon) and
LIII–LVI (procurement, supply chain, EPC/engineering network).

## Materials (db/procurement.ts: `boq_items`, `epds`)
- Bill of quantities per project: material, category, specification, quantity and unit, manufacturer, supplier,
  origin, distance and transport mode, unit cost, lead time, recycled and bio-based content, EPD, service life,
  circularity (avoid, reduce, reuse, reclaim, recycle, recover, dispose), design for disassembly, end of life,
  hazards, certification.
- EPD library per entity (Builders & suppliers → EPD library): manufacturer, product, program operator, registration
  number, PCR, geography, declared unit, GWP per EN 15804 stage (A1–A3 required; A4, A5, B, C, D optional), validity,
  third-party verification, verifier, link.
- Embodied carbon (`embodiedCarbon`, lib/procurement/logic.ts) = quantity × EPD GWP, only when the item's unit matches
  the EPD's declared unit (t/tonnes, m3/m³ … are normalized). Items without an EPD, without a quantity or in another
  unit are listed as gaps; nothing is estimated. Expired EPDs are flagged. The page shows upfront carbon (A1–A5),
  totals by stage, EPD coverage, material cost and the longest lead times.

## Procurement (`procurement_packages`, `bids`)
- Packages: category (EPC, major equipment, BoP, civil, electrical, supply, services, consultancy, logistics, O&M),
  scope, pipeline stage (need, RFI, RFQ/RFP, bids, clarification, evaluation, BAFO, selection, negotiation, award,
  manufacturing, logistics, delivered, closed), budget, bids due, award target, needed on site, **E&S requirements to
  flow down to the contractor**, local-content target, evaluation weights.
- Bids: bidder (organization or name), price, schedule, lead time, warranty, liquidated damages, origin country,
  factory, Incoterms, port, local content, financing support, exceptions, status, and evaluator scores (0–10).
- Evaluation (`evaluateBids`): weighted score out of 10 across technical, cost, schedule, warranty/performance,
  bankability, track record, local content, materials/carbon, financing support (default weights editable per
  package). Cost is 10 × lowest price ÷ price when all bids share a currency; unscored criteria count as zero and are
  listed; a single bid is flagged.
- Award (`awardBid`): selects the bid, marks the others Not selected, moves the package to Awarded, and registers a
  draft agreement of the matching type (EPC contract, equipment purchase, BoP, construction, supply, service,
  engineering services, logistics, O&M) against the project with the bidder as counterparty. Its summary carries the
  scope, price, schedule, warranty, LDs, Incoterms, bid exceptions and the E&S flow-down, ready for counsel review.
- Today → Delivery: bids due within 7 days, award targets passed without an award, and awarded supply whose lead time
  from today lands after the date it is needed on site.

## Builders and suppliers network (`network_profiles`)
- One profile per organization: roles (EPC, OEM, supplier, engineer, contractor, O&M, logistics), asset classes,
  technologies, countries, project-size range, completed assets, track record, bonding, insurance, balance sheet,
  warranty, bankability, references, Regenera's own experience.
- Matching (`matchNetwork`): the role that fits the package; asset class required when both sides state it; country,
  size and bankability add to the score; reasons and gaps are shown. "Add as invited" puts the organization on the
  bid list; nothing is emailed.

## Where it surfaces
Project tabs Materials and Procurement; Builders & suppliers (/network) with the EPD library; Today → Delivery; the
project brief PDF (BoQ carbon and packages); awarded agreements in the contract register.

## Not built yet
Construction control tower (NTP to COD, change orders, claims, payments, punch list) and operations (production,
availability, covenants). Industrial symbiosis and material passports.

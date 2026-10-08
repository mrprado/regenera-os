# Phase 20: case-study tooling (approved 2026-10-08: "build all and deploy")

From the RA-ESG funding case study: the steps done by hand become OS features. Additive migration 0053.

1. **Document → records.** Upload a sponsor PDF. Claude reads it (PDF input, prompt `documents.extract_projects`,
   logged in ai_runs). You get proposed projects and figures, each with its page number. Nothing is written until you
   confirm. On confirm, projects are created or matched by name, and each figure becomes a claim marked
   "source_provided", with document evidence and page. The PDF is stored in R2 and registered in Documents.
2. **Portfolio screening** (`/projects/portfolio?org=`). One run covers every project of a sponsor and shows:
   - location precision;
   - the solar yield check against PVGIS;
   - sanctions state of the sponsor and parties;
   - capital programmes by lane;
   - country risk;
   - data-room folders filled;
   - open document requests.
   
   A "Run site checks" button builds place profiles, a few per click to respect rate limits. CSV export.
3. **Sponsor registry checks.** The Companies House connector (free API key `COMPANIES_HOUSE_API_KEY`) saves a
   snapshot of the company's officers, charges, recent filings and status, and records what changed since the last
   one. A weekly job re-checks and raises a notification on changes. The company number comes from the
   `companies_house` identifier alias.
4. **Location precision.** New project fields `location_precision` (survey, reported site, town, region, country) and
   `location_source`.
   - "Place approximately" finds a town or locality through OpenStreetMap and stores it as town precision.
   - Atlas draws approximate points faded and labels the basis.
5. **Document requests.** Requests per counterparty or project come from templates. The institutional readiness
   template has 12 sections; there is also a short NDA pack. Each item has a status (requested / received / partial /
   not available / under NDA / waived) and can link to a document and an NDA. Pages: `/documents/requests` and
   `/documents/requests/[id]`.
6. **Capital providers as records.**
   - Import the programme catalogue as organizations plus capital profiles; repeating the import updates them rather
     than duplicating.
   - New routing tags on capital profiles: lane, preference, ticket band, routing stage.
   - New page `/capital/providers`.
7. **Regulatory guardrails as data.**
   - Regulated products: a sponsor's bonds, shares or funds, with their names and aliases. Outbound drafts that name
     one are held by the send-time compliance gate.
   - Protected parties: non-circumvention, with the agreement and expiry. Introductions to an active protected party
     are blocked.
   - New page `/network/guardrails`.
8. **Country risk.** World Bank indicators: inflation, GDP growth, electricity access, and the Worldwide Governance
   Indicators for rule of law and government effectiveness. Shown with the curated country notes on Diligence and in
   portfolio screening.
9. **Portfolio memo** (`/projects/portfolio/memo?org=`). A printable multi-project case study generated from OS
   records, ending with a sources section.
10. **Live visibility and fixes.**
    - Browser errors are reported to `/api/client-errors` (signed-in users, throttled), stored in `client_errors`,
      logged to Workers logs, and listed under Settings → Jobs. Atlas map errors are reported too.
    - Sign-in now returns you to the page you asked for; the layout no longer forces `/today`.

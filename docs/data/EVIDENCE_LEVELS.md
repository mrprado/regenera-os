# Evidence levels

| Level | Name | Examples | Used for |
|---|---|---|---|
| 1 | Global screening | WRI, World Bank, NASA, ESA, Copernicus, FAO, OpenStreetMap, Global Solar / Wind Atlas | Opportunity screening, site prioritization, portfolio comparison, preliminary risk |
| 2 | Jurisdictional diligence | Grid operator, municipality, land registry, environmental / water authority, energy regulator, mining authority, planning office | Permitting, development assessment, legal and regulatory diligence |
| 3 | Project-specific evidence | Interconnection study, PPA, lease / title, EIA, hydrology, geotechnical, engineering, resource assessment, financial model, legal opinions, survey | Investment diligence, IC review, financing, closing |

Every project shows three separate readings (Project 360 → Site & land → Environmental & spatial screening):

- **Screening confidence** (High / Partial / Low / None): Level 1 dimensions covered and sources used.
- **Development diligence** (Complete / Partial / Incomplete / None): jurisdictions, verified requirements, permits,
  jurisdictional (Level 2) sources.
- **Investment diligence** (Complete / Partial / Incomplete / None): project-specific evidence types held.

They are never blended into one score (lib/data-providers/evidence.ts `evidenceReadings`).

Screening flags (water stress, forest intersection, protected-area proximity, land-conversion signal, grid gap, energy
access opportunity, community exposure, climate exposure) are observations with a dataset and the local diligence they
call for. None is a legal conclusion and none labels a project harmful or compliant. A person can mark a flag reviewed
or dismiss it with a reason.

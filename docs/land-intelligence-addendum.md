# Land and parcel intelligence — focused architecture addendum

2026-09-25. Supplements `master-spec.md` Parts XIII–XV and the land-contract requirements. Source review: Land id's public product documentation, not an authenticated product trial. These are additions to Regenera's Place/GIS workflow, not a replacement OS or a new public website.

## What the comparison established

Land id describes parcel identifiers/ownership search, linked property attributes, overlay inspection and measurements. That points to a missing parcel-level workflow beneath Regenera's existing project map. See [parcel data](https://id.land/product/parcel-data), [overlays](https://id.land/product/basemap-overlays), and [measurements](https://id.land/product/measurement-tool).

It also describes survey-image alignment, deed plotting, waypoint notes/photos and offline maps. These are useful references for site evidence collection. See [survey overlays](https://id.land/product/image-survey-overlays), [deed plotting](https://id.land/product/deed-plotting), [waypoints](https://id.land/product/waypoints), and [offline use](https://id.land/product/offline-use).

The [soil-report features](https://id.land/product/soil-reports) suggest reporting the area and proportion represented by each soil class instead of merely storing a soil label. The [database feature](https://id.land/product/database-builder) is a reference for mapped attributes; Regenera should expose its existing canonical records through views rather than build another database system.

## Required additions

### 1. Parcel identity and land assembly

A project is not a parcel. Support projects spanning several parcels and a parcel associated with several project phases or alternatives. A minimal Parcel reference carries jurisdiction, issuing authority, external cadastral ID, geometry/version, reported area/unit, source, source date, retrieval date and verification. Link landowners through existing people/organizations and roles; do not duplicate contacts.

Keep registry ownership claims, beneficial ownership, operating control and contractual land rights distinct. Track acquisition/lease/option status, access, easements and rights of way through existing contracts, obligations, constraints and decisions. Water/mineral rights and restrictions are relevant where applicable. These land-assembly links are Regenera-specific design requirements, not claims about Land id functionality.

Uniqueness is authority + jurisdiction + parcel identifier, with version history. Identical identifiers in different registries must not merge. A boundary import must never overwrite a reviewed boundary automatically.

### 2. Boundary workbench and spatial measurements

Render recorded polygons and lines; draw/edit candidate areas, split/assemble alternatives, measure geodesic distance/perimeter/area, and switch between hectares/acres and metric/imperial units. Preserve original geometry and declared coordinate system. Validate coordinate order, finite values, ring closure, holes, self-intersections, antimeridian handling and size limits.

Survey, cadastral, sponsor-provided and manually drawn geometries need explicit evidence status. Map measurements are indicative unless a qualified review establishes otherwise. An imagery boundary is not evidence of legal title.

### 3. Layer-driven site screening

Add layer groups and per-layer legends, opacity, coverage, source date, resolution, attribution and availability. Prioritize parcels, planning/zoning, flood, wetlands, contours/slope, soils, water, land cover and infrastructure. Many of these already appear in the master specification; the addition is the inspection and comparison workflow.

Support point/parcel selection, intersecting features, nearby infrastructure and comparison of candidate sites. Distinguish observed land use, tax-assessment use and planning zoning. A nearby transmission line does not establish spare grid capacity, access rights or interconnection eligibility.

Report unknown coverage explicitly. A layer returning no result must not become a conclusion that a site has no constraint. Coverage and freshness must travel with any report or export.

### 4. Buildable-area scenarios

Define scenarios from a versioned parcel/area, sourced exclusion layers, explicit setbacks and assumptions. Show gross area, excluded area and indicative remaining area. Union overlapping exclusions before subtraction so the same area is not counted twice. Store calculation/version, input layer dates, jurisdiction and reviewer.

Connect identified limitations to existing constraints, studies, engineering requirements, decisions and capital implications. Do not label an AI-generated result permitted, buildable or bankable without the appropriate reviews. This is a Regenera-specific extension of overlay analysis.

### 5. Survey, deed and document alignment

Link survey plans, title documents and site designs through the current document/version registry. Georeferenced overlays require coordinate reference system/datum, control points, transformation, residual alignment error, source scale, document version and reviewer. Deed interpretation/plotting stays a proposed geometry with source-page references until reviewed.

Support GeoJSON first; plan validated KML/KMZ/GPX and shapefile conversion with explicit CRS handling. File-size, decompression and vertex limits apply. Keep original uploaded evidence separate from display simplification.

### 6. Field observations and offline work

Waypoints need location, accuracy, capture time, author, notes, photo/document references, observed condition and links to project/parcel/asset. A field observation can propose an action, constraint or readiness review using the existing queues; it must not silently certify a condition.

Offline packages contain only authorized, license-permitted map content and minimum necessary records. Show package date/coverage/expiry. Queue edits with stable IDs and base versions; recheck permissions on sync and route conflicts to review. Test revoke/expiry, duplicate delivery, deletion and competing edits. Offline maps and media storage are not currently implemented.

### 7. Parcel evidence brief and comparison

Produce a sourced brief containing identity, boundary basis, known parties/rights, access, site area, physical context, constraints, missing evidence, studies and next actions. Soil summaries should show class coverage, area, method and uncertainty rather than a single unqualified productivity number.

Optional recorded valuation/sale/building attributes must distinguish assessed value, asking price, transaction price and modeled estimate. Include dates, units and currency; do not invent comparable sales or transplant U.S. tax/soil classifications globally.

Reuse project reports and document versions. Controlled share/export uses explicit field selection, data rights, audience authorization and revocation/expiry. Public sharing never exposes the private map API. Virtual tours are optional presentation views over approved content, not a new core product.

### 8. Provider coverage and global data model

Land id advertises U.S. parcel coverage on its [homepage](https://id.land/); this review did not establish a reusable Land id API or redistribution entitlement. Do not enable a Land id integration or assume its data is free.

Use jurisdiction-specific official or licensed providers through the existing integration registry. Store geographic coverage, permitted uses, retention/caching/export rights, update frequency and source quality. Missing coverage falls back to reviewed manual evidence. Region-specific tax, parcel and soil classifications remain namespaced and are not universal enums.

## Reuse and implementation status

| Capability | Reuse | Status |
|---|---|---|
| Site evidence checklist | `PLACE_GAPS`, project Place, contracts, studies, constraints | Expanded locally in this change |
| Parcel relationships | Existing projects + parties + jurisdictions + sources | Required; schema design/migration pending |
| Boundaries and measurements | `projects.geometry`, existing MapLibre map | Required; rendering/editing/calculations pending |
| Survey/deed overlays | Existing documents and versions | Required; processing/alignment pending |
| Spatial screening/scenarios | Existing place facts, constraints, risks and engineering | Required; spatial analysis pending |
| Field/offline | Existing activities, tasks, documents and approvals | Required; capture/sync pending |
| Parcel briefs | Existing reports and project briefs | Required; template and evidence aggregation pending |

No new schema, paid service, provider integration or publication is introduced by this addendum. It defines the missing workflow and exposes missing evidence in the existing Place screen.

## Phased acceptance

L1: parcel references, links and geometry validation; additive migrations and dedupe/scoping tests. L2: boundary display/edit/measurement and layer inspection with geometry/CRS/units tests. L3: sourced overlay intersections and area scenarios, tested for overlapping exclusions and absent/stale coverage. L4: field capture, offline sync and controlled reports with permission/conflict/export tests.

The existing full-test/build `spawn EPERM` blocker must be resolved before calling these phases release-verified. This document is not a claim that L1–L4 have shipped.

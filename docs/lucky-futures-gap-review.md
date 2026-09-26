# Lucky Futures: focused additions to Regenera OS

Reviewed 2026-09-25 in the browser: https://www.luckyfutures.world/, /map, /map/notpla, /about and /resources. This is a public discovery website reference, not an OS architecture benchmark. No directory entries, descriptions, images or resource catalog were imported.

## Observed patterns and disposition

| Reference pattern | Regenera gap / disposition |
|---|---|
| Map-linked organization directory | Added a browsable directory over existing scoped projects, organizations, opportunities, signals and funding records. The list and map apply identical filters. |
| Category filters and city navigation | Added country, sector, existing topic and place-text filtering. Topic options derive from organization industry and project systems. No duplicate taxonomy; no new geocoder calls or city database. |
| Organization narrative and full detail page | Existing record pages are retained. Map previews now include stored descriptions, recorded topics, a validated website link and location context. |
| Connection from location to useful information | Project previews link to Place evidence, Partners and Funding in the existing project record. |
| Resource library | Add to the architecture as a curated view over existing documents/sources/research, linked by project, geography and system. No separate books/films/games database. A dedicated curated resource view is not implemented in this phase. |
| Contribution forms | Future intake should reuse existing site intake and proposals, with deduplication, review and provenance before canonical writes. No public submission form or anonymous OS write endpoint added. |
| Random discovery | Not adopted: scoped search and fit-results navigation are more useful for this operational map. |
| Public organization stories | If Regenera later publishes a public atlas, use explicitly approved publication records; never expose private OS API responses. No public atlas created here. |

## Changes specific to Regenera

The existing globe, terrain, clusters, attribution, layer switches and detail links remain. No organization, project, resource or tag tables were added. Missing/invalid coordinate pairs are excluded and counted; (0,0) remains valid for actual records, while the existing funding sentinel is excluded. Signal coordinates use a complete valid pair, never a mixture of a signal's latitude and its organization's longitude.

Location basis is explicit: recorded project coordinates, organization office, signal location or eligible-country funding reference. An office or country point is not presented as a confirmed development site. Record update time is not called verification time.

The directory loads independently of the map renderer. Failed hazard requests return an error instead of a successful empty collection. Incomplete map imagery and unavailable hazard context are visible. Motion preferences are honored for discovery navigation and the initial pulse.

## Remaining map capabilities from the canonical specification

These predate the Lucky Futures comparison: project geometry rendering/drawing, saved views, geographic proximity/within-area queries, temporal layers, infrastructure overlays, source freshness per dataset, scenario comparison and place-to-system-need analysis. They remain in the architecture roadmap; they are not claimed as shipped by this discovery change.

## Verification

See `architecture-audit-2026-09-25.md` for validation results and the remaining architecture phases. No deployment or production migration was performed.

# Atlas contents panel and build/preview (2026-10-06)

## Build: the "spawn EPERM" diagnosis

`npm run build` succeeds on this Windows 11 machine (Node v24.19.0, npm 11.17.0) when run as the normal user, with no
repository change. Child processes start normally here: `esbuild.exe --version` and Vite's `net use` probe both succeed.
The earlier `spawn EPERM` while loading `vite.config.ts` came from the Codex execution sandbox, which blocks process
creation. It was not a fault in the repository or dependencies.

`scripts/windows-toolchain.mjs` (imported by `scripts/run-framework.mjs` on Windows only) is kept. It only turns an EPERM
from Vite's optional `net use` drive probe into that probe's normal error callback. It does not grant permissions or
patch dependencies, and other errors are re-thrown. In a sandbox that blocks esbuild itself, the build still fails
honestly: run the build in an environment that may start child processes.

## Preview

```
npm run build                         # rebuilds dist/ from source (source is authoritative; hand-edited dist is overwritten)
node scripts/preview-integrated.mjs   # run from this folder; serves dist/ at http://127.0.0.1:4311 with .sites-runtime/integrated-preview/demo.sqlite
```

Open `/demo` → "Explore as founder" (fictional workspace), then `/map`. Stop the server before rebuilding.

## Panel structure (app/(app)/map/explore-panel.tsx)

1. **Header and collapse:** the « button hides the panel; an "Explore" button reopens it (key L also toggles).
2. **Work objective** (`lib/map/objectives.ts`):
   - It suggests evidence layers, record types and a basemap, and links real workflows.
   - "Apply suggested layers" ADDS layers and record types; manually enabled layers are never removed.
   - Layers the catalogue does not offer are listed as unavailable.
   - It never changes classifications, creates records or runs actions.
3. **Project or site:**
   - The list contains only accessible projects that have a recorded location.
   - Choosing one loads its site record (`/api/map/site`), fits its boundary or point, and carries the id into the Site
     workbench.
   - The card shows stage, location, Regenera role and gaps: no location, no boundary, no recorded type, site record
     unavailable.
4. **Asset / project type chips:**
   - Derived only from the project's recorded `assetClass` and `technology` (`assetTypesOf`), never from its name.
   - A project can carry several types (PV + BESS gives Solar, Storage and Solar + Storage).
   - Selection is a union within the dimension.
   - Counts are computed from records matching every OTHER active filter.
   - Projects with no recorded type are counted and drop out when a type is selected.
5. **Lifecycle and geography:**
   - Lifecycle labels map onto the canonical `PROJECT_STAGES` (`LIFECYCLE`) and apply to projects only. Deal and signal
     statuses are not lifecycle.
   - Region is the project's recorded subdivision.
   - Geography scope:
     - All accessible locations.
     - Current map area: follows `moveend` and handles the antimeridian.
     - Selected project boundary: point-in-polygon on the real recorded geometry; disabled when none is recorded.
6. **Record types:** Projects, Organizations, Opportunities, Funding/tenders/calls and Signals, with counts. Sites are
   not offered, because there is no separate site record. Hazards stay in Evidence layers.
7. **Active filters and results:**
   - Each filter has a removable chip; "Clear filters" resets business filters only (camera, basemap and evidence
     layers are kept), alongside "Fit results".
   - The result line reads "X matching records" with a per-type breakdown.
   - The map and the list draw the same filtered set.
   - The empty state says what to do next.
8. **Evidence layers tab:**
   - A prominent Power grid switch reusing the existing `power` layer (caveat: proximity is not capacity, queue
     position or rights).
   - Search, enabled-only filter, collapsible groups (infrastructure, nature, hazards, earth observation, weather,
     movement, space), and the provenance details per layer (tier, provider, period, licence, freshness, failures).
   - Specialist tracking and sensor looks sit at the end.
9. **Inspector:**
   - The existing detail, plus real links: Risk & evidence, Capital, Site workbench.
   - A note that commitments, funding, rights, outreach and public claims are proposed for human approval elsewhere.

Share links add `x=` to the hash (objective, project id, types, lifecycle, country, region, scope, sector, system). They
hold keys and ids only; sign-in and workspace membership still apply.

## Tests

```
node --experimental-strip-types tests/atlas-filters.node.test.mjs      # 7 pass: union, intersection, lifecycle, antimeridian, boundary + holes, counts, suggestions
node --experimental-strip-types tests/map-discovery.node.test.mjs      # 7 pass
node --experimental-transform-types --import ./scripts/test-context-loader.mjs tests/context.node.test.ts   # 10 pass
npm run typecheck                                                       # 0 errors
npm run build                                                           # succeeds
```

## Not done / limits

- Native D1 Vitest suites (`npm test`) were not run in this pass.
- Project/site selection lists located projects only; unlocated projects are counted with a link to Projects.
- The Community Development and EV Charging chips appear only when a project records them. `community` has no
  asset-class value yet, so it never appears until classification support is added.
- Selected-boundary filtering needs a recorded Polygon/MultiPolygon. Drawn (unsaved) shapes are not yet used as a
  filter scope.
- The development value engine, partnerships, value ledger, tranche transitions, public-metric publication workflow,
  interface detection and origination-mission ingestion from the wider brief were not implemented in this pass.
- The analytical light basemap draws progressively from OpenFreeMap; on a cold start the globe can look empty for some
  seconds while tiles load. In the demo, GDACS hazards return 503 because outbound calls are disabled, and they are
  shown as unavailable.

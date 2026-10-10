# Purposeful dashboards and Command record review

Authorized by Alan's dashboard redesign request and subsequent right-side review drawer request.

Base: `redesign/merge-chatgpt-ui`, `37cbaf1`. Implementation branch: `redesign/purposeful-dashboards`.

## Behavior

- Command opens workspace record links in a right-side dialog. The same record route renders with its shell chrome hidden, keeping the existing guard, data query, record tabs and server actions. The dashboard remains in place. The record scrolls independently; Escape and close restore focus to the initiating link. A separate control opens the full workspace.
- Modified clicks and downloads keep browser behavior. External URLs, authentication, API endpoints, Command controls and Atlas remain normal navigation. The drawer does not weaken framing headers or introduce a new authentication path.
- The map leads Command, uses terrain tiles with subdued colors, preserves location-quality marks and actual record filters, and defaults to all mapped records. Exact, approximate and country-level locations remain distinguished. No ecological layers or scores are invented.
- The isolated-demo always-open project focus panel is removed from Command; the underlying project operating views remain intact.
- Discover uses scan runs; Projects a portfolio; Capital financing destinations and counterparties; Network a searchable directory; Intelligence a question-to-decision research launchpad; Engage a commercial opportunity layout; Workflows the scoped open task queue with deadlines and owners; Steward the commitment register.
- Identical records are consolidated and attention items are not repeated in the secondary record list. Independent records sharing a register URL remain visible. Counts and definitions remain accessible in a collapsed register snapshot. Tools and material content are retained through disclosure and existing routes.
- Atlas and Settings retain their specialist working interfaces. Palette tokens unify their surrounding chrome with the other work areas; no map source or settings functionality is removed.

## Verification

- TypeScript check passed.
- Targeted ESLint passed with the existing raster-tile img performance warning.
- Five focused Node checks passed: record query/anchor preservation, forbidden review destinations, normal map/Command navigation, record consolidation, attention deduplication.
- Actual client components rendered in a separate illustrative fixture. Drawer open, in-record navigation, Escape and restored trigger focus were verified in the browser. Project layout and record consolidation were checked.
- Full vinext preview is blocked here by EPERM when Vite writes through the external dependency junction. Full build, D1-backed record actions and deployment remain to be validated in the canonical local checkout. The fixture is not production evidence.

## Apply and release

Use this branch or apply the supplied patch to a clean branch based on `37cbaf1`. Run `npm run ci` in the canonical checkout, then inspect Command record review with the real workspace and each area landing page. Check authenticated and open-access views, project tabs, permissions, narrow screens and the Atlas controls. Deploy with the existing `npm run deploy` workflow only after the complete checks pass. No migrations or environment changes are required by this change.

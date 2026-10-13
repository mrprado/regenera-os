# Decision-focused redesign — October 2026

Authorized by Alan: apply the seven dashboard rules across the build, use the repository, deploy, and ensure each screen has a dashboard appropriate to its purpose.

## Shared rules

1. Surface up to four relevant, clickable metrics before secondary detail. Retain counting definitions and refresh scope.
2. Group information by the decisions the module owns.
3. Share tokens, typography, surfaces, controls and accessibility behavior, not identical page compositions.
4. Keep charts secondary; exact capital comparisons use tables, work uses queues, spatial assessment uses Atlas.
5. Only show trends from actual historical observations. Current stage counts are explicitly snapshots. Do not invent history or percentage deltas.
6. Make applied filters visible and clearable. GET URLs remain shareable, including hidden view context.
7. Use concrete next-action labels, owners and due dates where recorded. Unknown evidence stays unknown.

## Area compositions

- Dashboard: visible operating metrics, decisions, daily brief and queue; expanded desk for detailed registers.
- Discover: discovery-run ledger and findings requiring qualification.
- Projects: portfolio grid with project blockers and selected project context.
- Capital: counterparty comparison table, financing routes, mandate criteria and selected counterparty context.
- Network: relationship directory, conversations to advance and party context.
- Intelligence: research workbench, evidence-reading list and question review.
- Engage: commercial opportunity cards and next-action review; fees distinct from project capital.
- Workflows: ordered delivery queue with recorded deadlines and owners; execution exceptions.
- Steward: commitment review register emphasizing responsible parties and evidence before closure.
- Atlas: preserve the map-first workspace, layer groups and existing selection tools; shared tokens apply without replacing the spatial UI with a list dashboard.

## Implemented scope

Landing dashboards use their existing scoped hub data and distinct presentations above. No migrations, new integrations, fabricated chart series or changes to approval/authentication boundaries. Metric refresh timestamps describe the query, not verification of its evidence. Supporting register/detail pages retain their domain-specific forms and tabs and inherit shared surface/filter improvements.

## Release

Build on redesign/purposeful-dashboards, which includes redesign/merge-chatgpt-ui and later privacy fixes. Production deployment uses scripts/deploy.mjs and requires Cloudflare authentication. GitHub CI verifies changes but does not deploy them.

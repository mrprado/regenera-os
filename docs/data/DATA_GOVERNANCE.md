# Data governance

Two permission models. They are never merged.

## Open institutional data

WRI, World Bank, NASA, ESA, Copernicus, FAO, IRENA, OpenStreetMap, GBIF, government portals.

- Licence per dataset, recorded in the catalogue; unknown terms are "Verify"
- Attribution text stored per dataset and printed in exports
- Redistribution checked before export; restricted data is cited, not packaged
- Source integrity: originals kept; AI interpretation stored separately
- Credentials are server-side only; the integration registry can disable any source

## Governed knowledge

Traditional, Indigenous and place-based knowledge, oral history, sacred or cultural knowledge, community records,
vernacular building knowledge.

- Community, custodian and knowledge holder
- Consent status and authorized use
- Commercial-use, publication and digitization permission
- Attribution requirement
- Benefit-sharing structure (equity participation, revenue share, community fund) and community governance
- Restrictions, review / expiry date and revocation
- Access states: public, internal, restricted, community-governed, consent-pending, non-commercial, confidential

Governed knowledge lives in the community module (db/community.ts) and in the built-environment traditional-knowledge
register, which uses the same fields. It is not in the dataset registry, is not searchable by default, and never
reaches global search, Ask the OS or the MCP server.

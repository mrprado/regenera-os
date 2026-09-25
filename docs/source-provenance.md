# Source provenance

Principle: every fact knows its source, date and freshness; AI inference is never silently turned into verified fact.

- **Organizations and people:** per-field `field_sources` (source, date, confidence, URL) on every enrichment.
- **Place facts:** `place_facts` hold source (integration), URL, tier, licence, period described, retrieval date and
  state (API-derived, verified, estimated, stale, conflicting).
- **Requirements and permits:** source citation, tier, reviewer, review date, evidence, next verification date.
- **Capital:** criteria carry a source and last-verified date; qualifications carry method, verifier, dates and an
  evidence reference; commitments carry evidence; gate decisions carry reviewer and evidence.
- **Contracts:** registered key terms reference the executed document and clause numbers; obligations carry their
  source clause.
- **Tables for general use:** `sources` (type, organization, title, URL or document, tier 1–5, published, retrieved,
  effective, expires, jurisdiction, licence) and `verifications` (entity, field, source, state, confidence, verifier,
  next verification) are in place for the next steps (field-level verification UI).
- **Tiers:** 1 government, regulator, utility; 2 multilateral, scientific, peer reviewed; 3 professional, technical,
  commercial; 4 reputable secondary; 5 discovery, social, AI.
